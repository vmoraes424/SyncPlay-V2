//! Detecção automática do ponto de mix por análise de amplitude da cauda do áudio.
//!
//! Implementa o mesmo algoritmo do SyncPlay legado (audioMixPoint.js):
//! - Reduz o arquivo a 500 amostras (básico ou avançado) via **streaming** (sem Vec gigante)
//! - Normaliza pelo pico
//! - Varre da cauda para o início procurando onde sobe acima do limiar
//! - Calcula mixTime com teto de 5% da duração total
//! - Cache **em memória** (OnceLock + Mutex) carregado do disco uma vez; persiste só ao gravar.

use crate::error::AppResult;
use rodio::{Decoder, Source};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::BufReader;
use std::sync::{Mutex, OnceLock};


const SAMPLES_COUNT: usize = 500;
const MIX_POINTS_PATH: &str = "C:/SyncPlay/Configs/mixPoints.json";

// ─── Tipos de cache ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MixCacheEntry {
    #[serde(rename = "mixTime")]
    pub mix_time: f64,
    pub crc32: String,
    /// String no formato "<pct>%3" — ex.: "25%3" — compatível com o legado JS.
    pub sensitivity: String,
    /// "basic" | "advanced"
    #[serde(rename = "type")]
    pub mix_type: String,
}

// ─── Cache em memória (carregado uma vez, protegido por Mutex) ────────────────

/// Retorna a referência estática ao cache em memória.
/// Na primeira chamada, lê o arquivo de disco. Chamadas seguintes são puro acesso a RAM.
fn get_mem_cache() -> &'static Mutex<HashMap<String, MixCacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, MixCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| {
        let data: HashMap<String, MixCacheEntry> = fs::read_to_string(MIX_POINTS_PATH)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        Mutex::new(data)
    })
}

fn persist_cache(cache: &HashMap<String, MixCacheEntry>) {
    // Compact JSON: mais rápido de serializar e menor no disco.
    if let Ok(json) = serde_json::to_string(cache) {
        let _ = fs::write(MIX_POINTS_PATH, json);
    }
}

// ─── Resultado retornado ao front ──────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct MixPointResult {
    pub mix_time_sec: f64,
    pub detected: bool,
}

#[derive(Debug, Serialize)]
pub struct CachedMixPointResult {
    pub mix_time_sec: f64,
    pub detected: bool,
    pub cache_hit: bool,
}

// ─── Utilitários de chave / CRC ───────────────────────────────────────────────

fn cache_key(media_id: &str) -> String {
    media_id.to_string()
}

/// Pseudo-CRC compatível com o legado: "sz:<bytes>-tm:<mtime_ms>".
fn file_pseudo_crc(path: &str) -> String {
    if let Ok(meta) = fs::metadata(path) {
        let size = meta.len();
        let mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis())
            .unwrap_or(0);
        format!("sz:{}-tm:{}", size, mtime_ms)
    } else {
        "unknown".to_string()
    }
}

fn sensitivity_str(sensitivity_pct: f64) -> String {
    format!("{}%3", sensitivity_pct as u32)
}

// ─── Ponto de entrada público (com cache em memória) ──────────────────────────

/// Calcula (ou recupera do cache em memória) o ponto de mix automático.
///
/// O lock é mantido apenas para operações de memória (µs), nunca durante a
/// decodificação do arquivo de áudio (que pode levar segundos).
///
/// `media_id` é o ID numérico da mídia na biblioteca e é usado como chave no
/// cache persistido em `mixPoints.json` (em vez do caminho do arquivo).
pub fn compute_mix_point(
    path: &str,
    media_id: &str,
    duration_sec: f64,
    sensitivity_pct: f64,
    advanced: bool,
) -> AppResult<MixPointResult> {
    let key = cache_key(media_id);
    let sens_str = sensitivity_str(sensitivity_pct);
    let type_str = if advanced { "advanced" } else { "basic" };
    let crc = file_pseudo_crc(path);

    // ── Cache check (lock breve — só leitura de HashMap em RAM) ──────────────
    {
        let cache = get_mem_cache().lock().unwrap();
        if let Some(entry) = cache.get(&key) {
            if entry.crc32 == crc && entry.sensitivity == sens_str && entry.mix_type == type_str {
                return Ok(MixPointResult {
                    mix_time_sec: entry.mix_time,
                    detected: entry.mix_time > 0.0,
                });
            }
        }
    }
    // ── lock liberado antes de decodificar ────────────────────────────────────

    let result = compute_mix_point_for_file(path, duration_sec, sensitivity_pct / 100.0, advanced)?;

    // ── Atualiza cache: lock liberado antes da escrita em disco ───────────────
    // Clonar o snapshot enquanto o lock está ativo é O(n) mas rápido (só RAM).
    // Assim o lock não fica preso durante a I/O de disco, que pode bloquear
    // outras threads esperando o cache em PCs com disco lento.
    let snapshot = {
        let mut cache = get_mem_cache().lock().unwrap();
        cache.insert(
            key,
            MixCacheEntry {
                mix_time: result.mix_time_sec,
                crc32: crc,
                sensitivity: sens_str,
                mix_type: type_str.to_string(),
            },
        );
        cache.clone()
    };
    persist_cache(&snapshot);

    Ok(result)
}

/// Consulta apenas o cache (mixPoints.json em memória), sem decodificar áudio.
///
/// Retorna `cache_hit=true` quando encontrou entrada para o `media_id` com
/// CRC/hash, sensibilidade e tipo compatíveis.
pub fn get_cached_mix_point(
    path: &str,
    media_id: &str,
    sensitivity_pct: f64,
    advanced: bool,
) -> CachedMixPointResult {
    let key = cache_key(media_id);
    let sens_str = sensitivity_str(sensitivity_pct);
    let type_str = if advanced { "advanced" } else { "basic" };
    let crc = file_pseudo_crc(path);

    let cache = get_mem_cache().lock().unwrap();
    if let Some(entry) = cache.get(&key) {
        if entry.crc32 == crc && entry.sensitivity == sens_str && entry.mix_type == type_str {
            return CachedMixPointResult {
                mix_time_sec: entry.mix_time,
                detected: entry.mix_time > 0.0,
                cache_hit: true,
            };
        }
    }

    CachedMixPointResult {
        mix_time_sec: 0.0,
        detected: false,
        cache_hit: false,
    }
}

// ─── Algoritmo de detecção — streaming sem Vec grande ─────────────────────────

/// Analisa o arquivo de áudio usando uma única passagem em streaming.
///
/// Em vez de acumular todas as amostras em um `Vec<f32>` (que pode chegar a
/// dezenas de MB por arquivo), estima o `block_size` a partir de
/// `duration_sec × sample_rate` e mantém apenas os 500 acumuladores de bloco.
/// Memória extra: O(500) ≈ 8 KB por chamada em vez de O(total_amostras).
///
/// **Otimizações de CPU para PCs fracos:**
/// - BufReader com 128 KB reduz syscalls de leitura do arquivo.
/// - Substitui `%` e `/` no loop quente por contadores incrementais — elimina
///   ~3 divisões inteiras por amostra (≈ 78 M divisões numa música de 5 min / 44.1 kHz stereo).
/// - O branch `advanced` é içado para fora do loop quente (dois loops separados).
/// - O lock do cache é liberado antes da escrita em disco.
fn compute_mix_point_for_file(
    path: &str,
    duration_sec: f64,
    sensitivity: f64, // 0.0–1.0
    advanced: bool,
) -> AppResult<MixPointResult> {
    let no_detection = || MixPointResult { mix_time_sec: 0.0, detected: false };

    if duration_sec <= 0.0 {
        return Ok(no_detection());
    }

    let file = File::open(path)?;
    // Buffer de 128 KB: reduz drasticamente os syscalls de leitura em arquivos de áudio grandes.
    let buf = BufReader::with_capacity(128 * 1024, file);
    let source = match Decoder::new(buf) {
        Ok(d) => d,
        Err(_) => return Ok(no_detection()),
    };

    let channels = source.channels() as usize;
    let channels = channels.max(1);
    let sample_rate = source.sample_rate() as f64;

    // Estima total de amostras do canal 0 para calcular block_size sem ler o arquivo inteiro.
    // Se a duração for imprecisa, as amostras extras cairão no último bloco (min clamp).
    let estimated_ch0 = ((duration_sec * sample_rate) as usize).max(SAMPLES_COUNT * 2);
    let block_size = (estimated_ch0 / SAMPLES_COUNT).max(1);

    let mut audio_data = [0.0f32; SAMPLES_COUNT];
    // Acumuladores para modo avançado (média dos abs a cada 10 posições do bloco)
    let mut block_accum = [0.0f32; SAMPLES_COUNT];
    let mut block_counts = [0usize; SAMPLES_COUNT];

    let mut total_ch0 = 0usize;

    // ── Contadores que substituem as divisões/módulos no loop quente ──────────
    // channel_pos  : 0..channels-1  (substitui interleaved_pos % channels)
    // current_block: 0..SAMPLES_COUNT (substitui ch0_idx / block_size)
    // pos_in_block : 0..block_size-1  (substitui ch0_idx % block_size)
    let mut channel_pos = 0usize;
    let mut current_block = 0usize;
    let mut pos_in_block = 0usize;

    // Constante içada: evita reavaliação de `block_size <= 10` a cada amostra.
    let sample_all_in_block = block_size <= 10;

    // O branch `advanced` é resolvido fora do loop para que o compilador gere
    // dois loops tight sem nenhum branch condicional interno.
    if advanced {
        // step10: substitui pos_in_block % 10 — cicla 0..=9 e reseta no início
        // de cada novo bloco, espelhando o comportamento do algoritmo legado.
        let mut step10 = 0usize;
        for sample in source {
            if channel_pos == 0 {
                let block = current_block.min(SAMPLES_COUNT - 1);
                if sample_all_in_block || step10 == 0 {
                    block_accum[block] += (sample as f32).abs();
                    block_counts[block] += 1;
                }
                step10 += 1;
                if step10 == 10 {
                    step10 = 0;
                }
                pos_in_block += 1;
                if pos_in_block == block_size {
                    pos_in_block = 0;
                    step10 = 0; // reseta por bloco (como o original)
                    current_block += 1;
                }
                total_ch0 += 1;
            }
            channel_pos += 1;
            if channel_pos == channels {
                channel_pos = 0;
            }
        }
    } else {
        for sample in source {
            if channel_pos == 0 {
                let block = current_block.min(SAMPLES_COUNT - 1);
                // Modo básico: mantém o último valor do bloco (equivale ao original)
                audio_data[block] = (sample as f32).abs();
                pos_in_block += 1;
                if pos_in_block == block_size {
                    pos_in_block = 0;
                    current_block += 1;
                }
                total_ch0 += 1;
            }
            channel_pos += 1;
            if channel_pos == channels {
                channel_pos = 0;
            }
        }
    }

    if total_ch0 == 0 {
        return Ok(no_detection());
    }

    // Finaliza médias do modo avançado
    if advanced {
        for i in 0..SAMPLES_COUNT {
            audio_data[i] = if block_counts[i] > 0 {
                block_accum[i] / block_counts[i] as f32
            } else {
                0.0
            };
        }
    }

    // Normalização pelo pico
    let peak = audio_data.iter().cloned().fold(0.0f32, f32::max);
    if peak <= 0.0 {
        return Ok(no_detection());
    }
    for v in &mut audio_data {
        *v /= peak;
    }

    // Varredura da cauda (direita → esquerda)
    let threshold = sensitivity as f32;
    let mut mix_slice = SAMPLES_COUNT;
    let mut found_mix = false;

    let mut i = SAMPLES_COUNT as isize - 1;
    while i >= 0 && !found_mix {
        let idx = i as usize;
        if audio_data[idx] <= threshold {
            mix_slice = idx;
        } else {
            found_mix = true;
        }
        i -= 1;
    }

    let mix_time_sec = if found_mix && mix_slice < SAMPLES_COUNT {
        let raw = (duration_sec / SAMPLES_COUNT as f64) * (SAMPLES_COUNT - mix_slice - 1) as f64;
        // Teto: máximo 5% da duração total
        raw.min(duration_sec * 0.05)
    } else {
        0.0
    };

    Ok(MixPointResult {
        mix_time_sec,
        detected: found_mix,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_finds_quiet_tail() {
        // Simula 500 amostras: 450 altas, 50 baixas
        let mut data = [0.8f32; SAMPLES_COUNT];
        for v in &mut data[450..] {
            *v = 0.1;
        }
        let peak = data.iter().cloned().fold(0.0f32, f32::max);
        for v in &mut data {
            *v /= peak;
        }

        let threshold = 0.25f32;
        let mut mix_slice = SAMPLES_COUNT;
        let mut found_mix = false;
        let mut i = SAMPLES_COUNT as isize - 1;
        while i >= 0 && !found_mix {
            let idx = i as usize;
            if data[idx] <= threshold {
                mix_slice = idx;
            } else {
                found_mix = true;
            }
            i -= 1;
        }

        assert!(found_mix);
        assert_eq!(mix_slice, 450);

        let duration = 200.0f64;
        let mix_time = (duration / SAMPLES_COUNT as f64) * (SAMPLES_COUNT - mix_slice - 1) as f64;
        let mix_time = mix_time.min(duration * 0.05);
        // 49 amostras × (200/500) = 19.6 s → clamped para 200*0.05 = 10 s
        assert!((mix_time - 10.0).abs() < 0.001);
    }

    #[test]
    fn all_quiet_returns_zero() {
        let mut data = [0.05f32; SAMPLES_COUNT];
        let peak = data.iter().cloned().fold(0.0f32, f32::max);
        for v in &mut data {
            *v /= peak;
        }
        let threshold = 0.25f32;
        let mut mix_slice = SAMPLES_COUNT;
        let mut found_mix = false;
        let mut i = SAMPLES_COUNT as isize - 1;
        while i >= 0 && !found_mix {
            let idx = i as usize;
            if data[idx] <= threshold {
                mix_slice = idx;
            } else {
                found_mix = true;
            }
            i -= 1;
        }
        assert!(!found_mix);
        let _ = mix_slice;
    }
}
