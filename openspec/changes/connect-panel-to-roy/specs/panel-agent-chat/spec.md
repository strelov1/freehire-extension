## ADDED Requirements

### Requirement: Session creation authenticated by Bearer JWT

The panel SHALL create a Roy session by sending `POST ${ROY_ORIGIN}/sessions`
with an `Authorization: Bearer <jwt>` header and an empty JSON body, and SHALL
read `session_id` from the response.

#### Scenario: Signed-in user starts a chat

- **WHEN** a signed-in user sends the first message and the panel has a stored JWT
- **THEN** the panel POSTs to `${ROY_ORIGIN}/sessions` with `Authorization: Bearer <jwt>` and an empty body
- **AND** it uses the returned `session_id` for the WebSocket turn

#### Scenario: Not signed in

- **WHEN** no JWT is stored
- **THEN** the panel does not create a session and prompts the user to sign in

### Requirement: WebSocket authenticated by the roy-jwt subprotocol

The panel SHALL open its Roy WebSocket as
`new WebSocket(royWsUrl(), ['roy-jwt', <jwt>])`, carrying the JWT in the second
subprotocol slot alongside the literal `roy-jwt` marker.

#### Scenario: Panel connects with a valid token

- **WHEN** the panel connects and offers subprotocols `['roy-jwt', <valid-jwt>]`
- **THEN** the Roy `/ws` handshake upgrades and selects the `roy-jwt` subprotocol

#### Scenario: Invalid or missing token

- **WHEN** the offered token is missing the `roy-jwt` marker or is not a valid JWT
- **THEN** the Roy `/ws` handshake is rejected with HTTP 401 and no session is bridged

### Requirement: One chat turn end-to-end

After connecting, the panel SHALL drive one turn by subscribing to frames before
attaching, attaching to the session from sequence 0, acquiring the input lease,
and sending the user's text; it SHALL fold streamed `TurnEvent`s into the
rendered message list and close the assistant message on the terminal `result`.

#### Scenario: User sends a message and sees a streamed reply

- **WHEN** the user sends a message on a connected session
- **THEN** the panel calls `attach` (from_seq 0), then `acquire_input`, then fires `send` with the text
- **AND** incoming `assistant_text` frames accumulate into a streaming assistant message
- **AND** the terminal `result` frame ends the streaming state

#### Scenario: Turn ends with an error

- **WHEN** a turn fails with a backend `error` event instead of a `result`
- **THEN** the panel surfaces the error and does not leave the message streaming forever

### Requirement: Read page feeds the current page to the agent

The "Read page" action SHALL send the current page snapshot to the agent as a
context-prefixed chat message over the same session, replacing the removed
echo-stub round trip.

#### Scenario: User reads the current page

- **WHEN** the user clicks "Read page" on a session
- **THEN** the panel reads the page snapshot and sends it to Roy as a context-prefixed `send` message

### Requirement: Roy accepts the extension's JWT (backend)

Roy (`freehire-agent`) SHALL authenticate the extension's cross-origin requests
from the JWT: `require_user` SHALL accept `Authorization: Bearer <jwt>` when no
valid session cookie is present, and `ws_handler` SHALL accept a valid
`Sec-WebSocket-Protocol: roy-jwt,<jwt>` and echo the `roy-jwt` marker in the
upgrade response. Cookie authentication SHALL remain the primary path.

#### Scenario: Bearer token on the HTTP API

- **WHEN** a request to a protected route carries no valid cookie but a valid `Authorization: Bearer <jwt>`
- **THEN** `require_user` resolves the user and forwards the request

#### Scenario: Subprotocol token on the WebSocket

- **WHEN** a `/ws` upgrade carries no valid cookie but a valid `roy-jwt` subprotocol token
- **THEN** `ws_handler` upgrades the connection and selects the `roy-jwt` subprotocol

#### Scenario: Cookie path unchanged

- **WHEN** a same-origin request carries a valid session cookie
- **THEN** authentication succeeds exactly as before, with no dependency on the bearer or subprotocol paths
