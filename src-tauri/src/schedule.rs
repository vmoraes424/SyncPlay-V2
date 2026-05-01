pub const DAY_SECONDS: u32 = 86_400;

pub type SecondsOfDay = u32;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ScheduledMusic {
    pub id: String,
    pub title: String,
    pub path: String,
    pub target_start_sec: SecondsOfDay,
    pub duration_sec: Option<f64>,
    pub mix_out_sec: Option<f64>,
    pub disabled: bool,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ScheduledMedia {
    pub id: String,
    pub title: String,
    pub media_type: String,
    pub path: String,
    pub duration_sec: Option<f64>,
    pub mix_out_sec: Option<f64>,
    pub disabled: bool,
    pub discarded: bool,
    pub manual_discard: bool,
    pub fixed: bool,
    pub manual_type: bool,
    pub disable_discard: bool,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ScheduledBlock {
    pub id: String,
    pub start_sec: SecondsOfDay,
    pub size_sec: f64,
    pub disable_discard: bool,
    pub medias: Vec<ScheduledMedia>,
}

#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)]
pub enum ScheduleSelection {
    Active {
        music_id: String,
        elapsed_sec: f64,
    },
    Upcoming {
        music_id: String,
        starts_in_sec: f64,
    },
    Empty,
}

#[derive(Debug, Clone, PartialEq)]
pub enum BlockScheduleSelection {
    Active {
        music_id: String,
        elapsed_sec: f64,
        active_queue_ids: Vec<String>,
    },
    Upcoming {
        music_id: String,
        starts_in_sec: f64,
        active_queue_ids: Vec<String>,
    },
    Empty {
        active_queue_ids: Vec<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum ScheduleMode {
    ContinuousDaily,
    FiniteDay,
}

/// Normaliza qualquer valor de segundos para o intervalo [0, 86400).
/// Aceita valores negativos, pois alguns cálculos fazem subtração.
pub fn normalize_day_seconds(seconds: f64) -> SecondsOfDay {
    seconds.rem_euclid(DAY_SECONDS as f64) as u32
}

/// Diferença circular entre `now` e um `target` futuro.
/// Retorna quantos segundos faltam para chegar em `target`.
pub fn seconds_until(now: SecondsOfDay, target: SecondsOfDay) -> u32 {
    if target >= now {
        target - now
    } else {
        DAY_SECONDS - now + target
    }
}

/// Diferença circular entre um `start` passado e `now`.
/// Retorna quantos segundos se passaram desde `start`.
pub fn elapsed_since(start: SecondsOfDay, now: SecondsOfDay) -> u32 {
    seconds_until(start, now)
}

/// Verifica se `now` está dentro da janela [start, end).
/// Suporta janelas que cruzam meia-noite (quando start > end).
pub fn is_inside_window(now: SecondsOfDay, start: SecondsOfDay, end: SecondsOfDay) -> bool {
    if start <= end {
        now >= start && now < end
    } else {
        // janela atravessa meia-noite
        now >= start || now < end
    }
}

/// Calcula o fim efetivo da janela de uma mídia:
///   fim = target_start_sec + duration_sec - mix_out_sec
///
/// Retorna None quando duration_sec não está disponível.
/// O resultado é normalizado para o intervalo do dia (% 86400).
#[allow(dead_code)]
fn item_effective_end(item: &ScheduledMusic) -> Option<SecondsOfDay> {
    let duration = item.duration_sec?;
    let mix_out = item.mix_out_sec.unwrap_or(0.0);
    let effective = (duration - mix_out).max(0.0);
    Some(normalize_day_seconds(
        item.target_start_sec as f64 + effective,
    ))
}

#[allow(dead_code)]
pub fn select_music_by_start_time(
    items: &[ScheduledMusic],
    now_sec: SecondsOfDay,
    mode: ScheduleMode,
) -> ScheduleSelection {
    let mut valid_items: Vec<&ScheduledMusic> = items
        .iter()
        .filter(|item| !item.disabled)
        .filter(|item| !item.id.trim().is_empty())
        .filter(|item| !item.path.trim().is_empty())
        .filter(|item| item.target_start_sec < DAY_SECONDS)
        .collect();

    valid_items.sort_by_key(|item| item.target_start_sec);

    if valid_items.is_empty() {
        return ScheduleSelection::Empty;
    }

    // Primeira passagem: usa o fim efetivo próprio de cada mídia
    // (target_start_sec + duration_sec - mix_out_sec).
    // Esse é o método correto segundo a regra de negócio do legado.
    for current in &valid_items {
        let Some(window_end) = item_effective_end(current) else {
            continue;
        };

        if is_inside_window(now_sec, current.target_start_sec, window_end) {
            let raw_elapsed = elapsed_since(current.target_start_sec, now_sec) as f64;

            // O elapsed é limitado à duração efetiva para não ultrapassar o arquivo.
            let duration = current.duration_sec.unwrap_or(f64::MAX);
            let mix_out = current.mix_out_sec.unwrap_or(0.0);
            let max_elapsed = (duration - mix_out).max(0.0);

            return ScheduleSelection::Active {
                music_id: current.id.clone(),
                elapsed_sec: raw_elapsed.min(max_elapsed),
            };
        }
    }

    // Segunda passagem: fallback para itens sem duration_sec.
    // Usa o início do próximo item como limite da janela (comportamento anterior).
    for (index, current) in valid_items.iter().enumerate() {
        if item_effective_end(current).is_some() {
            continue; // já verificado na primeira passagem
        }

        let next = match valid_items.get(index + 1).copied() {
            Some(item) => item,
            None if mode == ScheduleMode::ContinuousDaily => valid_items[0],
            None => continue,
        };

        if is_inside_window(now_sec, current.target_start_sec, next.target_start_sec) {
            return ScheduleSelection::Active {
                music_id: current.id.clone(),
                elapsed_sec: elapsed_since(current.target_start_sec, now_sec) as f64,
            };
        }
    }

    // Nenhuma mídia está ativa. Procura a próxima que ainda não começou.
    let next = valid_items
        .iter()
        .find(|item| item.target_start_sec > now_sec)
        .copied()
        .or_else(|| {
            if mode == ScheduleMode::ContinuousDaily {
                Some(valid_items[0])
            } else {
                None
            }
        });

    let Some(next) = next else {
        return ScheduleSelection::Empty;
    };

    ScheduleSelection::Upcoming {
        music_id: next.id.clone(),
        starts_in_sec: seconds_until(now_sec, next.target_start_sec) as f64,
    }
}

pub fn counts_for_schedule(media: &ScheduledMedia) -> bool {
    !media.disabled && !media.discarded && !media.manual_discard
}

pub fn can_auto_discard(media: &ScheduledMedia) -> bool {
    media.media_type.eq_ignore_ascii_case("music")
        && !media.disabled
        && !media.discarded
        && !media.manual_discard
        && !media.fixed
        && !media.manual_type
        && !media.disable_discard
}

fn can_auto_restore(media: &ScheduledMedia) -> bool {
    media.media_type.eq_ignore_ascii_case("music")
        && !media.disabled
        && media.discarded
        && !media.manual_discard
        && !media.fixed
        && !media.manual_type
        && !media.disable_discard
}

pub fn effective_duration(media: &ScheduledMedia) -> f64 {
    if counts_for_schedule(media) {
        let duration = media.duration_sec.unwrap_or(0.0);
        let mix_out = media.mix_out_sec.unwrap_or(0.0);
        (duration - mix_out).max(0.0)
    } else {
        0.0
    }
}

fn raw_effective_duration(media: &ScheduledMedia) -> f64 {
    let duration = media.duration_sec.unwrap_or(0.0);
    let mix_out = media.mix_out_sec.unwrap_or(0.0);
    (duration - mix_out).max(0.0)
}

fn active_block_duration(block: &ScheduledBlock) -> f64 {
    block.medias.iter().map(effective_duration).sum()
}

fn is_vem_or_hc(media: &ScheduledMedia) -> bool {
    media.media_type.eq_ignore_ascii_case("vem")
        || media.title.trim_start().starts_with("#hc")
        || media.path.trim_start().starts_with("#hc")
}

fn discard_previous_vem_or_hc_if_needed(block: &mut ScheduledBlock, music_index: usize) {
    let mut remaining = 2;
    let mut cursor = music_index;

    while cursor > 0 && remaining > 0 {
        cursor -= 1;
        if is_vem_or_hc(&block.medias[cursor])
            && !block.medias[cursor].disabled
            && !block.medias[cursor].manual_discard
        {
            block.medias[cursor].discarded = true;
            remaining -= 1;
        } else {
            break;
        }
    }
}

fn restore_previous_vem_or_hc_if_needed(block: &mut ScheduledBlock, music_index: usize) {
    let mut remaining = 2;
    let mut cursor = music_index;

    while cursor > 0 && remaining > 0 {
        cursor -= 1;
        if is_vem_or_hc(&block.medias[cursor])
            && !block.medias[cursor].disabled
            && !block.medias[cursor].manual_discard
        {
            block.medias[cursor].discarded = false;
            remaining -= 1;
        } else {
            break;
        }
    }
}

fn apply_discard(block: &mut ScheduledBlock, music_discard_time_sec: f64, discard_type: &str) {
    if block.disable_discard {
        return;
    }

    let block_end = block.start_sec as f64 + block.size_sec.max(0.0);
    let discard_limit = block_end + music_discard_time_sec.max(0.0);
    let mut real_end = block.start_sec as f64 + active_block_duration(block);

    for index in (0..block.medias.len()).rev() {
        if real_end <= discard_limit {
            break;
        }

        if can_auto_discard(&block.medias[index]) {
            block.medias[index].discarded = true;
            discard_previous_vem_or_hc_if_needed(block, index);
            real_end = block.start_sec as f64 + active_block_duration(block);
        }
    }

    if real_end >= block_end {
        return;
    }

    for index in 0..block.medias.len() {
        if can_auto_restore(&block.medias[index]) {
            let projected_end = real_end + raw_effective_duration(&block.medias[index]);

            if projected_end < discard_limit {
                block.medias[index].discarded = false;
                restore_previous_vem_or_hc_if_needed(block, index);
                real_end = block.start_sec as f64 + active_block_duration(block);
            } else if discard_type.eq_ignore_ascii_case("basic") {
                break;
            }
        }
    }
}

#[derive(Debug, Clone)]
struct RuntimeMedia {
    id: String,
    path: String,
    start_sec: SecondsOfDay,
    duration_sec: Option<f64>,
    effective_duration_sec: f64,
    counts_for_schedule: bool,
}

fn recalculate_block_media_starts(block: &ScheduledBlock) -> Vec<RuntimeMedia> {
    let mut accumulated = 0.0;
    let mut runtime = Vec::with_capacity(block.medias.len());

    for media in &block.medias {
        let start_sec = normalize_day_seconds(block.start_sec as f64 + accumulated);
        let counts = counts_for_schedule(media);
        let effective = effective_duration(media);

        runtime.push(RuntimeMedia {
            id: media.id.clone(),
            path: media.path.clone(),
            start_sec,
            duration_sec: media.duration_sec,
            effective_duration_sec: effective,
            counts_for_schedule: counts,
        });

        if counts {
            accumulated += effective;
        }
    }

    runtime
}

pub fn select_music_from_blocks(
    blocks: &[ScheduledBlock],
    now_sec: SecondsOfDay,
    music_discard_time_sec: f64,
    discard_type: &str,
) -> BlockScheduleSelection {
    let mut runtime_items = Vec::new();

    for source_block in blocks {
        if source_block.size_sec <= 0.0 || source_block.medias.is_empty() {
            continue;
        }

        let mut block = source_block.clone();
        apply_discard(&mut block, music_discard_time_sec, discard_type);
        runtime_items.extend(recalculate_block_media_starts(&block));
    }

    runtime_items.sort_by_key(|item| item.start_sec);

    let active_queue_ids: Vec<String> = runtime_items
        .iter()
        .filter(|item| item.counts_for_schedule)
        .filter(|item| !item.path.trim().is_empty())
        .map(|item| item.id.clone())
        .collect();

    for item in runtime_items
        .iter()
        .filter(|item| item.counts_for_schedule)
        .filter(|item| !item.path.trim().is_empty())
    {
        if item.effective_duration_sec <= 0.0 {
            continue;
        }

        let window_end = normalize_day_seconds(item.start_sec as f64 + item.effective_duration_sec);
        if is_inside_window(now_sec, item.start_sec, window_end) {
            let raw_elapsed = elapsed_since(item.start_sec, now_sec) as f64;
            let max_elapsed = item
                .duration_sec
                .unwrap_or(item.effective_duration_sec)
                .min(item.effective_duration_sec);

            return BlockScheduleSelection::Active {
                music_id: item.id.clone(),
                elapsed_sec: raw_elapsed.min(max_elapsed),
                active_queue_ids,
            };
        }
    }

    let next = runtime_items
        .iter()
        .filter(|item| item.counts_for_schedule)
        .filter(|item| !item.path.trim().is_empty())
        .min_by_key(|item| seconds_until(now_sec, item.start_sec));

    match next {
        Some(item) => BlockScheduleSelection::Upcoming {
            music_id: item.id.clone(),
            starts_in_sec: seconds_until(now_sec, item.start_sec) as f64,
            active_queue_ids,
        },
        None => BlockScheduleSelection::Empty { active_queue_ids },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn music(id: &str, target_start_sec: SecondsOfDay) -> ScheduledMusic {
        ScheduledMusic {
            id: id.to_string(),
            title: id.to_string(),
            path: format!("{id}.mp3"),
            target_start_sec,
            duration_sec: None,
            mix_out_sec: None,
            disabled: false,
        }
    }

    fn music_with_duration(
        id: &str,
        target_start_sec: SecondsOfDay,
        duration_sec: f64,
        mix_out_sec: f64,
    ) -> ScheduledMusic {
        ScheduledMusic {
            id: id.to_string(),
            title: id.to_string(),
            path: format!("{id}.mp3"),
            target_start_sec,
            duration_sec: Some(duration_sec),
            mix_out_sec: Some(mix_out_sec),
            disabled: false,
        }
    }

    fn block_media(id: &str, duration_sec: f64) -> ScheduledMedia {
        ScheduledMedia {
            id: id.to_string(),
            title: id.to_string(),
            media_type: "music".to_string(),
            path: format!("{id}.mp3"),
            duration_sec: Some(duration_sec),
            mix_out_sec: Some(0.0),
            disabled: false,
            discarded: false,
            manual_discard: false,
            fixed: false,
            manual_type: false,
            disable_discard: false,
        }
    }

    fn block(
        start_sec: SecondsOfDay,
        size_sec: f64,
        medias: Vec<ScheduledMedia>,
    ) -> ScheduledBlock {
        ScheduledBlock {
            id: "block".to_string(),
            start_sec,
            size_sec,
            disable_discard: false,
            medias,
        }
    }

    #[test]
    fn empty_when_no_valid_items() {
        assert_eq!(
            select_music_by_start_time(&[], 10, ScheduleMode::ContinuousDaily),
            ScheduleSelection::Empty
        );
    }

    #[test]
    fn upcoming_before_first_item_in_finite_day() {
        let items = vec![music("a", 28_800), music("b", 29_100)];

        assert_eq!(
            select_music_by_start_time(&items, 28_700, ScheduleMode::FiniteDay),
            ScheduleSelection::Upcoming {
                music_id: "a".to_string(),
                starts_in_sec: 100.0,
            }
        );
    }

    #[test]
    fn active_between_two_start_times() {
        let items = vec![music("a", 28_800), music("b", 29_100), music("c", 29_400)];

        assert_eq!(
            select_music_by_start_time(&items, 29_180, ScheduleMode::FiniteDay),
            ScheduleSelection::Active {
                music_id: "b".to_string(),
                elapsed_sec: 80.0,
            }
        );
    }

    #[test]
    fn wraps_to_first_item_after_last_in_continuous_daily() {
        let items = vec![music("a", 60), music("b", 86_340)];

        assert_eq!(
            select_music_by_start_time(&items, 86_350, ScheduleMode::ContinuousDaily),
            ScheduleSelection::Active {
                music_id: "b".to_string(),
                elapsed_sec: 10.0,
            }
        );
    }

    #[test]
    fn detects_window_crossing_midnight() {
        assert!(is_inside_window(86_399, 86_340, 60));
        assert!(is_inside_window(30, 86_340, 60));
        assert!(!is_inside_window(61, 86_340, 60));
    }

    #[test]
    fn ignores_invalid_and_disabled_items() {
        let mut disabled = music("disabled", 100);
        disabled.disabled = true;
        let empty_id = ScheduledMusic {
            id: " ".to_string(),
            title: "empty".to_string(),
            path: "empty.mp3".to_string(),
            target_start_sec: 200,
            duration_sec: None,
            mix_out_sec: None,
            disabled: false,
        };
        let valid = music("valid", 300);

        assert_eq!(
            select_music_by_start_time(&[disabled, empty_id, valid], 250, ScheduleMode::FiniteDay),
            ScheduleSelection::Upcoming {
                music_id: "valid".to_string(),
                starts_in_sec: 50.0,
            }
        );
    }

    // ── Testes da regra de fim efetivo ────────────────────────────────────────

    /// Valida a fórmula central do documento:
    ///   media[0].start = block.start = 36000
    ///   media[1].start = 36000 + 180 - 3 = 36177
    #[test]
    fn effective_end_matches_document_formula() {
        let a = music_with_duration("a", 36_000, 180.0, 3.0);
        // fim efetivo de A = 36000 + 180 - 3 = 36177
        assert_eq!(item_effective_end(&a), Some(36_177));
    }

    /// Mídia ativa é encontrada usando seu próprio fim efetivo,
    /// não o início da próxima.
    #[test]
    fn active_uses_effective_window_not_next_start() {
        // A: 36000..36177 (180s - 3s mix)
        // B: 36177..36373 (200s - 4s mix)
        let items = vec![
            music_with_duration("a", 36_000, 180.0, 3.0),
            music_with_duration("b", 36_177, 200.0, 4.0),
        ];

        // now=36100: dentro da janela de A
        assert_eq!(
            select_music_by_start_time(&items, 36_100, ScheduleMode::FiniteDay),
            ScheduleSelection::Active {
                music_id: "a".to_string(),
                elapsed_sec: 100.0,
            }
        );

        // now=36200: dentro da janela de B (36177..36373)
        assert_eq!(
            select_music_by_start_time(&items, 36_200, ScheduleMode::FiniteDay),
            ScheduleSelection::Active {
                music_id: "b".to_string(),
                elapsed_sec: 23.0,
            }
        );
    }

    /// Ao fim da grade (modo FiniteDay), nada de ativo depois do último fim efetivo.
    #[test]
    fn past_last_effective_end_returns_empty_in_finite_day() {
        // B termina efetivamente em 36177 + 200 - 4 = 36373
        let items = vec![
            music_with_duration("a", 36_000, 180.0, 3.0),
            music_with_duration("b", 36_177, 200.0, 4.0),
        ];

        assert_eq!(
            select_music_by_start_time(&items, 36_400, ScheduleMode::FiniteDay),
            ScheduleSelection::Empty
        );
    }

    /// O elapsed é limitado à duração efetiva (não ultrapassa o fim do arquivo).
    #[test]
    fn elapsed_capped_at_effective_duration() {
        // Música de 60s com 3s de mix → duração efetiva = 57s.
        // now = 36070 → elapsed_raw = 70s, mas deve ser limitado a 57s.
        let items = vec![music_with_duration("a", 36_000, 60.0, 3.0)];

        // 36000 + 60 - 3 = 36057 → janela termina em 36057
        // now=36070 está FORA da janela, portanto não retorna ativo
        assert_ne!(
            select_music_by_start_time(&items, 36_070, ScheduleMode::FiniteDay),
            ScheduleSelection::Active {
                music_id: "a".to_string(),
                elapsed_sec: 70.0,
            }
        );

        // now=36050 está DENTRO da janela, elapsed=50 (< 57, não é limitado)
        assert_eq!(
            select_music_by_start_time(&items, 36_050, ScheduleMode::FiniteDay),
            ScheduleSelection::Active {
                music_id: "a".to_string(),
                elapsed_sec: 50.0,
            }
        );
    }

    /// Janela que atravessa meia-noite com duration_sec disponível.
    #[test]
    fn effective_window_crossing_midnight() {
        // Música começa em 86390, dura 30s, mix 2s → fim efetivo = (86390+28) % 86400 = 18
        let items = vec![music_with_duration("late", 86_390, 30.0, 2.0)];

        assert_eq!(item_effective_end(&items[0]), Some(18));

        // now=86395: dentro da janela (86390..18)
        assert_eq!(
            select_music_by_start_time(&items, 86_395, ScheduleMode::ContinuousDaily),
            ScheduleSelection::Active {
                music_id: "late".to_string(),
                elapsed_sec: 5.0,
            }
        );

        // now=10: ainda dentro da janela que atravessa meia-noite
        assert_eq!(
            select_music_by_start_time(&items, 10, ScheduleMode::ContinuousDaily),
            ScheduleSelection::Active {
                music_id: "late".to_string(),
                elapsed_sec: 20.0,
            }
        );
    }

    #[test]
    fn normalize_day_seconds_wraps_correctly() {
        assert_eq!(normalize_day_seconds(0.0), 0);
        assert_eq!(normalize_day_seconds(86_400.0), 0);
        assert_eq!(normalize_day_seconds(86_401.0), 1);
        assert_eq!(normalize_day_seconds(-1.0), 86_399);
        assert_eq!(normalize_day_seconds(36_177.0), 36_177);
    }

    #[test]
    fn block_selection_recalculates_media_starts_from_block_start() {
        let blocks = vec![block(
            79_201,
            1_799.0,
            vec![block_media("first", 106.0), block_media("empire", 224.0)],
        )];

        assert_eq!(
            select_music_from_blocks(&blocks, 79_330, 120.0, "advanced"),
            BlockScheduleSelection::Active {
                music_id: "empire".to_string(),
                elapsed_sec: 23.0,
                active_queue_ids: vec!["first".to_string(), "empire".to_string()],
            }
        );
    }

    #[test]
    fn block_selection_discards_music_from_end_when_block_exceeds_limit() {
        let blocks = vec![block(
            1_000,
            300.0,
            vec![
                block_media("a", 100.0),
                block_media("b", 100.0),
                block_media("discarded-tail", 200.0),
            ],
        )];

        assert_eq!(
            select_music_from_blocks(&blocks, 1_150, 0.0, "advanced"),
            BlockScheduleSelection::Active {
                music_id: "b".to_string(),
                elapsed_sec: 50.0,
                active_queue_ids: vec!["a".to_string(), "b".to_string()],
            }
        );
    }

    #[test]
    fn manual_discard_does_not_count_for_recalculated_starts() {
        let mut skipped = block_media("manual", 100.0);
        skipped.manual_discard = true;
        let blocks = vec![block(
            2_000,
            300.0,
            vec![block_media("a", 100.0), skipped, block_media("b", 100.0)],
        )];

        assert_eq!(
            select_music_from_blocks(&blocks, 2_120, 120.0, "advanced"),
            BlockScheduleSelection::Active {
                music_id: "b".to_string(),
                elapsed_sec: 20.0,
                active_queue_ids: vec!["a".to_string(), "b".to_string()],
            }
        );
    }
}
