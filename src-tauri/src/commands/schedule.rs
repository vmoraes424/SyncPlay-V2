use crate::core::schedule::recalculate_schedule_from_blocks;
use crate::error::AppResult;
use crate::models::schedule::{
    BlockScheduleSelection, RecalculatedBlockSchedule, ScheduleMediaDiscard, ScheduleMediaStart,
    ScheduledBlock, ScheduledMedia, SecondsOfDay,
};
use chrono::{Local, Timelike};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledMediaDto {
    id: String,
    title: String,
    media_type: String,
    path: String,
    raw_start_sec: Option<SecondsOfDay>,
    duration_sec: Option<f64>,
    mix_out_sec: Option<f64>,
    disabled: bool,
    discarded: bool,
    manual_discard: bool,
    fixed: bool,
    manual_type: bool,
    disable_discard: bool,
}

impl From<ScheduledMediaDto> for ScheduledMedia {
    fn from(item: ScheduledMediaDto) -> Self {
        Self {
            id: item.id,
            title: item.title,
            media_type: item.media_type,
            path: item.path,
            raw_start_sec: item.raw_start_sec,
            duration_sec: item.duration_sec,
            mix_out_sec: item.mix_out_sec,
            disabled: item.disabled,
            discarded: item.discarded,
            manual_discard: item.manual_discard,
            fixed: item.fixed,
            manual_type: item.manual_type,
            disable_discard: item.disable_discard,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledBlockDto {
    id: String,
    start_sec: SecondsOfDay,
    size_sec: f64,
    disable_discard: bool,
    medias: Vec<ScheduledMediaDto>,
}

impl From<ScheduledBlockDto> for ScheduledBlock {
    fn from(block: ScheduledBlockDto) -> Self {
        Self {
            id: block.id,
            start_sec: block.start_sec,
            size_sec: block.size_sec,
            disable_discard: block.disable_discard,
            medias: block.medias.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleMediaStartDto {
    id: String,
    raw_start_sec: Option<SecondsOfDay>,
    start_sec: SecondsOfDay,
    start_label: String,
    active: bool,
}

impl From<ScheduleMediaStart> for ScheduleMediaStartDto {
    fn from(item: ScheduleMediaStart) -> Self {
        Self {
            id: item.id,
            raw_start_sec: item.raw_start_sec,
            start_sec: item.start_sec,
            start_label: item.start_label,
            active: item.active,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleMediaDiscardDto {
    id: String,
    discarded: bool,
}

impl From<ScheduleMediaDiscard> for ScheduleMediaDiscardDto {
    fn from(item: ScheduleMediaDiscard) -> Self {
        Self {
            id: item.id,
            discarded: item.discarded,
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ScheduleSelectionDto {
    #[serde(rename_all = "camelCase")]
    Active {
        music_id: String,
        elapsed_sec: f64,
        active_queue_ids: Vec<String>,
        media_starts: Vec<ScheduleMediaStartDto>,
        media_discards: Vec<ScheduleMediaDiscardDto>,
    },
    #[serde(rename_all = "camelCase")]
    Upcoming {
        music_id: String,
        starts_in_sec: f64,
        active_queue_ids: Vec<String>,
        media_starts: Vec<ScheduleMediaStartDto>,
        media_discards: Vec<ScheduleMediaDiscardDto>,
    },
    #[serde(rename_all = "camelCase")]
    Empty {
        active_queue_ids: Vec<String>,
        media_starts: Vec<ScheduleMediaStartDto>,
        media_discards: Vec<ScheduleMediaDiscardDto>,
    },
}

impl From<RecalculatedBlockSchedule> for ScheduleSelectionDto {
    fn from(schedule: RecalculatedBlockSchedule) -> Self {
        let media_discards = schedule
            .media_discards
            .into_iter()
            .map(Into::into)
            .collect();

        match schedule.selection {
            BlockScheduleSelection::Active {
                music_id,
                elapsed_sec,
                active_queue_ids,
                media_starts,
            } => Self::Active {
                music_id,
                elapsed_sec,
                active_queue_ids,
                media_starts: media_starts.into_iter().map(Into::into).collect(),
                media_discards,
            },
            BlockScheduleSelection::Upcoming {
                music_id,
                starts_in_sec,
                active_queue_ids,
                media_starts,
            } => Self::Upcoming {
                music_id,
                starts_in_sec,
                active_queue_ids,
                media_starts: media_starts.into_iter().map(Into::into).collect(),
                media_discards,
            },
            BlockScheduleSelection::Empty {
                active_queue_ids,
                media_starts,
            } => Self::Empty {
                active_queue_ids,
                media_starts: media_starts.into_iter().map(Into::into).collect(),
                media_discards,
            },
        }
    }
}

fn local_seconds_of_day() -> SecondsOfDay {
    let now = Local::now();
    now.num_seconds_from_midnight()
}

#[tauri::command]
pub fn get_schedule_selection(
    blocks: Vec<ScheduledBlockDto>,
    anchor_media_id: Option<String>,
    apply_schedule_discards: bool,
) -> AppResult<ScheduleSelectionDto> {
    let scheduled_blocks: Vec<ScheduledBlock> = blocks.into_iter().map(Into::into).collect();
    let now_sec = local_seconds_of_day();
    let selection = recalculate_schedule_from_blocks(
        &scheduled_blocks,
        now_sec,
        120.0,
        "advanced",
        anchor_media_id.as_deref(),
        apply_schedule_discards,
    );

    Ok(selection.into())
}
