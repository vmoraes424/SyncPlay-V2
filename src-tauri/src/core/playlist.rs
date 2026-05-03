//! Enriquecimento do JSON da playlist ao ler do disco (totais derivados).

use serde_json::{Map, Number, Value};

/// Soma `extra.mix.duration_real` (ms) de cada mídia do bloco e grava em `duration_real_total_ms`.
/// Ordem de fallback por faixa: `duration_real` → `duration_total` (mix) → `duration` (segundos → ms).
/// Escolha do mapa de mídias: `commercials` se não vazio; senão `musics` (alinhado ao front `blockMediaKind`).
pub fn enrich_playlist_json_with_block_duration_totals(root: &mut Value) {
    let Some(playlists) = root.get_mut("playlists").and_then(|p| p.as_object_mut()) else {
        return;
    };

    for playlist in playlists.values_mut() {
        let Some(blocks) = playlist.get_mut("blocks").and_then(|b| b.as_object_mut()) else {
            continue;
        };
        for block in blocks.values_mut() {
            let total_ms = sum_block_medias_duration_real_ms(block);
            if let Value::Object(obj) = block {
                obj.insert(
                    "duration_real_total_ms".to_string(),
                    Value::Number(Number::from(total_ms)),
                );
            }
        }
    }
}

fn block_media_records(block: &Value) -> Option<&Map<String, Value>> {
    if let Some(comm) = block.get("commercials").and_then(|v| v.as_object()) {
        if !comm.is_empty() {
            return Some(comm);
        }
    }
    block.get("musics").and_then(|v| v.as_object())
}

fn sum_block_medias_duration_real_ms(block: &Value) -> u64 {
    block_media_records(block)
        .map(|m| m.values().map(track_duration_real_ms).sum())
        .unwrap_or(0)
}

fn track_duration_real_ms(track: &Value) -> u64 {
    if let Some(ms) = mix_field_ms(track, "duration_real") {
        return ms;
    }
    if let Some(ms) = mix_field_ms(track, "duration_total") {
        return ms;
    }
    if let Some(secs) = track.get("duration").and_then(json_number_to_f64) {
        if secs.is_finite() && secs > 0.0 {
            return (secs * 1000.0).round() as u64;
        }
    }
    0
}

fn mix_field_ms(track: &Value, key: &str) -> Option<u64> {
    let mix = track.get("extra")?.get("mix")?;
    json_number_to_u64(mix.get(key)?)
}

fn json_number_to_u64(v: &Value) -> Option<u64> {
    let f = json_number_to_f64(v)?;
    if f.is_finite() && f >= 0.0 {
        Some(f.round() as u64)
    } else {
        None
    }
}

fn json_number_to_f64(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sums_duration_real_per_track() {
        let mut root = json!({
            "playlists": {
                "p1": {
                    "program": "Teste",
                    "blocks": {
                        "b1": {
                            "type": "musical",
                            "musics": {
                                "m1": { "extra": { "mix": { "duration_real": 120000.0 } } },
                                "m2": { "extra": { "mix": { "duration_real": 30_000.0 } } }
                            }
                        }
                    }
                }
            }
        });
        enrich_playlist_json_with_block_duration_totals(&mut root);
        let ms = root["playlists"]["p1"]["blocks"]["b1"]["duration_real_total_ms"]
            .as_u64()
            .unwrap();
        assert_eq!(ms, 150_000);
    }

    #[test]
    fn prefers_commercials_when_non_empty() {
        let mut root = json!({
            "playlists": {
                "p1": {
                    "program": "C",
                    "blocks": {
                        "b1": {
                            "type": "commercial",
                            "commercials": {
                                "c1": { "extra": { "mix": { "duration_real": 5000.0 } } }
                            },
                            "musics": {
                                "m1": { "extra": { "mix": { "duration_real": 999_000.0 } } }
                            }
                        }
                    }
                }
            }
        });
        enrich_playlist_json_with_block_duration_totals(&mut root);
        let ms = root["playlists"]["p1"]["blocks"]["b1"]["duration_real_total_ms"]
            .as_u64()
            .unwrap();
        assert_eq!(ms, 5000);
    }
}
