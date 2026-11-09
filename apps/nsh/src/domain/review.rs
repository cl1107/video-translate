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

pub fn collect_issues(
    segments: &[Segment],
    mode: SubtitleProcessingMode,
) -> Vec<ReviewIssue> {
    let require_translation = mode == SubtitleProcessingMode::Translate;
    let mut issues = Vec::new();
    for (index, segment) in segments.iter().enumerate() {
        if require_translation && segment.translated_text.as_deref().unwrap_or("").trim().is_empty()
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

        let line_width = longest_line_width(&segment.original_text)
            .max(longest_line_width(segment.translated_text.as_deref().unwrap_or("")));
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
