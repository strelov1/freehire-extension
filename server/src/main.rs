//! WebSocket stub for the freehire extension.
//!
//! Holds the two-way channel the side panel talks to. Right now every message
//! gets a mock reply; the seam for the real agent (freehire-agent / Roy) is
//! `mock_reply` — swap its body, the wire contract below stays put.

use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::Response,
    routing::any,
    Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;

const ADDR: &str = "127.0.0.1:3899";

/// Mirrors PageSnapshot in the extension's protocol.ts.
#[derive(Debug, Deserialize)]
struct PageSnapshot {
    #[allow(dead_code)]
    url: String,
    #[allow(dead_code)]
    title: String,
    headline: String,
    text: String,
}

/// What the panel sends us. Mirrors ClientEvent in protocol.ts.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientEvent {
    UserMessage { text: String },
    PageContext { snapshot: PageSnapshot },
}

/// What we send back. Mirrors ServerEvent in protocol.ts.
#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerEvent {
    AssistantMessage { text: String },
}

/// Stand-in for the real agent. This is the seam: replace the body with a
/// bridge to freehire-agent (Roy); the contract above does not change.
fn mock_reply(event: &ClientEvent) -> ServerEvent {
    match event {
        ClientEvent::UserMessage { text } => ServerEvent::AssistantMessage {
            text: format!("echo: {text}"),
        },
        ClientEvent::PageContext { snapshot } => ServerEvent::AssistantMessage {
            text: format!(
                "Got page \"{}\" ({} chars of text).",
                snapshot.headline,
                snapshot.text.len()
            ),
        },
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let app = Router::new().route("/ws", any(ws_handler));
    let addr: SocketAddr = ADDR.parse().expect("valid bind address");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind listener");
    tracing::info!("listening on ws://{addr}/ws");
    axum::serve(listener, app).await.expect("serve");
}

async fn ws_handler(ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(handle_socket)
}

async fn handle_socket(mut socket: WebSocket) {
    while let Some(Ok(msg)) = socket.recv().await {
        let Message::Text(text) = msg else { continue };
        let reply = match serde_json::from_str::<ClientEvent>(text.as_str()) {
            Ok(event) => mock_reply(&event),
            Err(err) => ServerEvent::AssistantMessage {
                text: format!("could not parse client event: {err}"),
            },
        };
        let payload = serde_json::to_string(&reply).expect("serialize reply");
        if socket.send(Message::Text(payload.into())).await.is_err() {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn echoes_user_messages() {
        let reply = mock_reply(&ClientEvent::UserMessage { text: "hi".into() });
        assert_eq!(
            reply,
            ServerEvent::AssistantMessage {
                text: "echo: hi".into()
            }
        );
    }

    #[test]
    fn summarizes_page_context() {
        let reply = mock_reply(&ClientEvent::PageContext {
            snapshot: PageSnapshot {
                url: "https://example.com".into(),
                title: "t".into(),
                headline: "Senior Go Engineer".into(),
                text: "abcde".into(),
            },
        });
        assert_eq!(
            reply,
            ServerEvent::AssistantMessage {
                text: "Got page \"Senior Go Engineer\" (5 chars of text).".into()
            }
        );
    }
}
