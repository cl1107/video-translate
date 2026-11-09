use nsh_base::nav_stack;
use nsh_core::prelude::*;

use crate::{nav, pages};

pub(crate) fn shell() -> impl IntoElement {
    nav_stack().flex_1().child(pages::workbench()).child(each(
        nav::open_reviews,
        |id: &String| id.clone(),
        |id, depth| {
            pages::review_page(id.get_untracked())
                .on_dismiss(move || nav::truncate(depth.get_untracked()))
        },
    ))
}
