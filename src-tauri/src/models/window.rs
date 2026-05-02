use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowStateFile {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_maximized: bool,
    pub is_full_screen: bool,
}
