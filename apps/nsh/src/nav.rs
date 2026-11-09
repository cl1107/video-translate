//! 校对页叠在工作台之上。

use nsh_core::prelude::*;

#[derive(Clone, Default)]
struct Routes(Vec<String>);

fn routes() -> Signal<Routes> {
    global::<Routes>()
}

pub(crate) fn open_reviews() -> Vec<String> {
    routes().with(|routes| routes.0.clone())
}

pub(crate) fn can_go_back() -> bool {
    routes().with(|routes| !routes.0.is_empty())
}

pub(crate) fn push_review(id: String) {
    routes().update(|routes| {
        if !routes.0.contains(&id) {
            routes.0.push(id);
        }
    });
}

pub(crate) fn pop() {
    routes().update(|routes| {
        routes.0.pop();
    });
}

pub(crate) fn truncate(depth: usize) {
    routes().update(|routes| routes.0.truncate(depth));
}
