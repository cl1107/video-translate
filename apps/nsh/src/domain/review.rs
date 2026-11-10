use super::model::{Segment, SubtitleProcessingMode, TranslationStatus};

pub const MIN_SUBTITLE_DURATION_SECONDS: f64 = 0.5;
pub const MAX_SUBTITLE_DURATION_SECONDS: f64 = 8.0;
pub const MAX_SUBTITLE_LINE_WIDTH: usize = 84;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewIssue {
    pub kind: &'static str,
    pub segment_id: String,
    pub message: String,
    pub related_segment_id: Option<String>,
}

fn display_width(text: &str) -> usize {
    text.chars()
        .map(|ch| if ch as u32 > 0x7f { 2 } else { 1 })
        .sum()
}

fn longest_line_width(text: &str) -> usize {
    text.split('\n').map(display_width).max().unwrap_or(0)
}

pub fn collect_issues(segments: &[Segment], mode: SubtitleProcessingMode) -> Vec<ReviewIssue> {
    let require_translation = mode == SubtitleProcessingMode::Translate;
    let mut issues = Vec::new();
    for (index, segment) in segments.iter().enumerate() {
        if require_translation
            && segment
                .translated_text
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
        {
            issues.push(ReviewIssue {
                kind: "empty-translation",
                segment_id: segment.id.clone(),
                message: "译文为空".to_string(),
                related_segment_id: None,
            });
        } else if segment.translation_status == Some(TranslationStatus::Fallback) {
            issues.push(ReviewIssue {
                kind: "fallback-translation",
                segment_id: segment.id.clone(),
                message: "译文回退为原文".to_string(),
                related_segment_id: None,
            });
        }

        let line_width = longest_line_width(&segment.original_text).max(longest_line_width(
            segment.translated_text.as_deref().unwrap_or(""),
        ));
        if line_width > MAX_SUBTITLE_LINE_WIDTH {
            issues.push(ReviewIssue {
                kind: "line-too-long",
                segment_id: segment.id.clone(),
                message: format!("单行过长（{line_width} 列）"),
                related_segment_id: None,
            });
        }

        let duration = segment.end - segment.start;
        if duration < MIN_SUBTITLE_DURATION_SECONDS {
            issues.push(ReviewIssue {
                kind: "too-short",
                segment_id: segment.id.clone(),
                message: "时长过短".to_string(),
                related_segment_id: None,
            });
        } else if duration > MAX_SUBTITLE_DURATION_SECONDS {
            issues.push(ReviewIssue {
                kind: "too-long",
                segment_id: segment.id.clone(),
                message: "时长过长".to_string(),
                related_segment_id: None,
            });
        }

        if index + 1 < segments.len() {
            let next = &segments[index + 1];
            if segment.end > next.start {
                issues.push(ReviewIssue {
                    kind: "overlap",
                    segment_id: segment.id.clone(),
                    message: "与下一段时间重叠".to_string(),
                    related_segment_id: Some(next.id.clone()),
                });
            }
        }
    }
    issues
}

/// 时间修改共用同一边界，拒绝 NaN、负数、零时长与越过媒体末尾。
pub fn validate_times(start: f64, end: f64, duration: Option<f64>) -> Result<(), String> {
    if !start.is_finite() || !end.is_finite() || start < 0.0 || end <= start {
        return Err("开始时间须非负，结束时间须晚于开始时间".into());
    }
    if duration.is_some_and(|limit| limit > 0.0 && end > limit + 0.001) {
        return Err("字幕时间超出媒体时长".into());
    }
    Ok(())
}

/// 在播放头处分开字幕，文本由使用者校对；不猜测文字与音频的对齐。
pub fn split_segment(segments: &mut Vec<Segment>, index: usize, at: f64) -> Result<(), String> {
    let segment = segments.get(index).ok_or("请先选择字幕段")?;
    if !at.is_finite() || at <= segment.start || at >= segment.end {
        return Err("播放头须位于当前段内部".into());
    }
    let mut right = segment.clone();
    right.id = super::model::new_id();
    right.start = at;
    right.original_text.clear();
    right.polished_text = None;
    right.translated_text = None;
    right.translation_status = None;
    segments[index].end = at;
    segments.insert(index + 1, right);
    Ok(())
}

pub fn merge_next(segments: &mut Vec<Segment>, index: usize) -> Result<(), String> {
    if index + 1 >= segments.len() {
        return Err("当前段后没有可合并的字幕".into());
    }
    if segments[index].translated_text.is_some() != segments[index + 1].translated_text.is_some() {
        return Err("两段译文须同时存在或同时为空，请先补齐译文".into());
    }
    let right = segments.remove(index + 1);
    let left = &mut segments[index];
    left.end = left.end.max(right.end);
    left.original_text = format!("{}\n{}", left.original_text, right.original_text)
        .trim()
        .into();
    // 润色不再代表编辑后的整句，重译使用校对后的原文。
    left.polished_text = None;
    left.translated_text = match (&left.translated_text, &right.translated_text) {
        (Some(a), Some(b)) => Some(format!("{a}\n{b}")),
        (None, None) => None,
        _ => return Err("两段译文须同时存在或同时为空，请先补齐译文".into()),
    };
    left.translation_status = Some(TranslationStatus::Reviewed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::model::Segment;

    fn seg(id: &str, start: f64, end: f64, original: &str, translated: Option<&str>) -> Segment {
        Segment {
            id: id.to_string(),
            start,
            end,
            original_text: original.to_string(),
            polished_text: None,
            translated_text: translated.map(str::to_string),
            translation_status: None,
            confidence: 1.0,
        }
    }

    #[test]
    fn extract_mode_skips_empty_translation() {
        let segments = vec![seg("a", 0.0, 1.0, "hello", None)];
        let issues = collect_issues(&segments, SubtitleProcessingMode::Extract);
        assert!(issues.iter().all(|issue| issue.kind != "empty-translation"));
    }

    #[test]
    fn translate_mode_flags_empty_translation() {
        let segments = vec![seg("a", 0.0, 1.0, "hello", None)];
        let issues = collect_issues(&segments, SubtitleProcessingMode::Translate);
        assert!(issues.iter().any(|issue| issue.kind == "empty-translation"));
    }
}

#[cfg(test)]
mod editing_tests {
    use super::*;
    fn segment() -> Segment {
        Segment {
            id: "one".into(),
            start: 1.0,
            end: 3.0,
            original_text: "你好世界".into(),
            polished_text: Some("旧润色".into()),
            translated_text: None,
            translation_status: None,
            confidence: 1.0,
        }
    }
    #[test]
    fn reject_invalid_times_and_out_of_bounds() {
        for (start, end) in [
            (f64::NAN, 2.0),
            (-1.0, 2.0),
            (2.0, 2.0),
            (3.0, 2.0),
            (0.0, f64::INFINITY),
        ] {
            assert!(validate_times(start, end, None).is_err());
        }
        assert!(validate_times(1.0, 3.0, Some(2.0)).is_err());
        assert!(validate_times(1.0, 3.0, Some(3.0)).is_ok());
    }
    #[test]
    fn split_and_merge_preserve_text_and_times() {
        let mut segments = vec![segment()];
        assert!(split_segment(&mut segments, 0, 1.0).is_err());
        split_segment(&mut segments, 0, 2.0).unwrap();
        assert_eq!(segments.len(), 2);
        assert_ne!(segments[0].id, segments[1].id);
        assert_eq!(segments[0].end, 2.0);
        assert_eq!(segments[1].start, 2.0);
        assert!(segments[1].original_text.is_empty());
        segments[1].original_text = "第二句".into();
        merge_next(&mut segments, 0).unwrap();
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].end, 3.0);
        assert_eq!(segments[0].original_text, "你好世界\n第二句");
        assert!(segments[0].polished_text.is_none());
    }
}
