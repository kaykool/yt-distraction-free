# YT Lite

Distraction-free, low-overhead YouTube playback and layout control for resource-constrained laptops.

## Language

### Content Types

**Regular Video**:
A pre-recorded video upload watched on demand, with on-demand comments below the player and no live broadcast state.
_Avoid_: VOD, normal video, standard video

**Live Stream**:
An actively broadcasting video stream (or active Premiere) occurring in real time, where Live Chat is the primary audience conversation surface.
_Avoid_: Live video, broadcast, stream

**Stream Replay**:
An archived recording of a past Live Stream watched after the broadcast has ended; behaves as a Regular Video with collapsed Comments by default and collapsed Chat Replay unless opened by the viewer.
_Avoid_: Past live stream, archived stream, VOD replay, live VOD

### Layout Surfaces

**Watch Page**:
The primary viewing surface where a Regular Video, Live Stream, or Stream Replay plays inside the clamped 16:9 player container.
_Avoid_: Video page, player page, watch view

**Sidebar**:
The secondary column alongside the player, hidden by default and revealed only when it holds active content (an open Live Chat or an expanded Engagement Panel).
_Avoid_: Right rail, right column, secondary panel, related column

**Recommendations**:
Algorithmic suggested-video lists and shelves that YT Lite permanently suppresses to eliminate distraction and layout overhead.
_Avoid_: Related videos, up next, suggested feed

**Comments**:
Viewer discussion threads below a Regular Video or Stream Replay, collapsed by default and revealed only when the viewer explicitly requests them.
_Avoid_: Discussion tab, comment section, below-fold thread

**Live Chat**:
The real-time message stream alongside an active Live Stream, shown in the Sidebar by default when available and collapsible into an on-demand reveal control.
_Avoid_: Chat box, stream chat, conversation bar

**Chat Replay**:
The recorded message stream attached to a Stream Replay, kept collapsed by default so the Watch Page layout matches a Regular Video unless the viewer opens it.
_Avoid_: Replay chat, archived chat

**Engagement Panel**:
A viewer-invoked auxiliary panel in the Sidebar (such as Transcript, Chapters, or Ask AI) that reveals the Sidebar while expanded and collapses it when closed.
_Avoid_: Side drawer, info panel, secondary drawer

### Playback Modes

**Audio-Only Mode**:
A user-toggled low-resource playback mode that suppresses video frame rendering and decoding while clamping stream quality to the lowest tier and preserving prior quality for restoration.
_Avoid_: Video-blocked mode, background audio, radio mode
