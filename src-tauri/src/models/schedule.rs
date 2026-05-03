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
    pub raw_start_sec: Option<SecondsOfDay>,
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
        media_starts: Vec<ScheduleMediaStart>,
    },
    Upcoming {
        music_id: String,
        starts_in_sec: f64,
        active_queue_ids: Vec<String>,
        media_starts: Vec<ScheduleMediaStart>,
    },
    Empty {
        active_queue_ids: Vec<String>,
        media_starts: Vec<ScheduleMediaStart>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScheduleMediaStart {
    pub id: String,
    pub raw_start_sec: Option<SecondsOfDay>,
    pub start_sec: SecondsOfDay,
    pub start_label: String,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScheduleMediaDiscard {
    pub id: String,
    pub discarded: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RecalculatedBlockSchedule {
    pub selection: BlockScheduleSelection,
    pub media_discards: Vec<ScheduleMediaDiscard>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum ScheduleMode {
    ContinuousDaily,
    FiniteDay,
}
