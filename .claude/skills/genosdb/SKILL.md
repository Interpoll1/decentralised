---
name: genosdb
description: eres un experto usando GenosDB
---

> **Working with AI on GenosDB.** This skill points an AI assistant (Claude Code,
> Cursor, etc.) at GenosDB's official documentation so it can build correct,
> idiomatic GenosDB code with you. GenosDB ships an unusually complete set of docs
> — API, CRUD, real-time, security, modules, architecture — which is exactly what
> lets an AI pair-program comfortably and get the details right the first time.
> All links below resolve to the official repository: https://github.com/estebanrfp/gdb

## API Reference & Core Documentation

- 📘 [GDB API Reference](https://github.com/estebanrfp/gdb/blob/main/docs/genosdb-api-reference.md) - Detailed API documentation
- ✨ [GenosDB Features](https://github.com/estebanrfp/gdb/blob/main/docs/genosdb-features.md) - Comprehensive feature overview and architecture
- 🧪 [GenosDB Examples](https://github.com/estebanrfp/gdb/blob/main/docs/genosdb-examples.md) - Live demos and community projects
- 🤝 [Distributed Trust Model](https://github.com/estebanrfp/gdb/blob/main/docs/genosdb-distributed-trust-model.md) - P2P trust via cryptographic identity, signed ops, and RBAC enforcement
- 🔒 [Zero Trust Security Model](https://github.com/estebanrfp/gdb/blob/main/docs/zero-trust-security-model.md) - Understanding GenosDB Zero-Trust Security Model: From Guest to SuperAdmin
- ↔️ [Cursor-Based Pagination](https://github.com/estebanrfp/gdb/blob/main/docs/cursor‐based-pagination.md) - Efficient paging with $after/$before/$limit
- 📚 [Resources](https://github.com/estebanrfp/gdb/blob/main/docs/genosdb-resources.md) - Helpful links: whitepaper, docs, wiki, npm, discussions

## CRUD Operations

- 🛠️ [CRUD Operation Guide](https://github.com/estebanrfp/gdb/blob/main/docs/crud-operations-guide.md) - Overview of CRUD APIs with links to detailed guides
- 📤 [PUT Guide](https://github.com/estebanrfp/gdb/blob/main/docs/put-guide.md) - Insert/update nodes; auto ID, persistence, and events
- 📥 [GET Guide](https://github.com/estebanrfp/gdb/blob/main/docs/get-guide.md) - Retrieve nodes by ID; optional real-time subscription
- 🗺️ [MAP Guide](https://github.com/estebanrfp/gdb/blob/main/docs/map-guide.md) - Query language, real-time subscriptions, and $edge traversal
- 🗑️ [REMOVE Guide](https://github.com/estebanrfp/gdb/blob/main/docs/remove-guide.md) - Delete nodes and clean up edges; persistence and notifications
- 🔗 [LINK Guide](https://github.com/estebanrfp/gdb/blob/main/docs/link-guide.md) - Create directed relationships between nodes

## GenosRTC (P2P Real-time)

- 📡 [GenosRTC API Reference](https://github.com/estebanrfp/gdb/blob/main/docs/genosrtc-api-reference.md) - P2P WebRTC API: rooms, data channels, audio/video
- ⚙️ [GenosRTC Architecture](https://github.com/estebanrfp/gdb/blob/main/docs/genosrtc-architecture.md) - Technical breakdown of GenosRTC Module architecture, decentralized signaling with Nostr, P2P transport with WebRTC
- 🧭 [GenosRTC Guide](https://github.com/estebanrfp/gdb/blob/main/docs/genosrtc-guide.md) - Tutorials for data channels and media streaming
- 🔷 [GenosRTC Cells](https://github.com/estebanrfp/gdb/blob/main/docs/genosrtc-cells.md) - Cellular mesh overlay: architecture, bridges, TTL, metrics, and scalability
- 🛰️ [Nostr Relay Deployment Guide](https://github.com/estebanrfp/gdb/blob/main/docs/nostr-guide.md) - How to run your own Nostr signaling relay for GenosDB/GenosRTC

## Security Manager

- 🔐 [SM API Reference](https://github.com/estebanrfp/gdb/blob/main/docs/sm-api-reference.md) - RBAC, identity (WebAuthn/mnemonic), signing/verification
- 🏗️ [SM Architecture](https://github.com/estebanrfp/gdb/blob/main/docs/sm-architecture.md) - Security Manager architecture overview
- 🔒 [SM ACLs Module](https://github.com/estebanrfp/gdb/blob/main/docs/sm-acls-module.md) - Node-level permissions and access control

## Optional Modules

- 🌳 [Radix Tree (rx)](https://github.com/estebanrfp/gdb/blob/main/docs/rx-radix-tree.md) - Prefix index with $startsWith and searchByPrefix
- 🕵️ [Audit Option (audit)](https://github.com/estebanrfp/gdb/blob/main/docs/audit.md) - Asynchronous moderation of the oplog with custom prompt
- 🤖 [NLQ Module](https://github.com/estebanrfp/gdb/blob/main/docs/nlq-module.md) - Natural Language for Queries in db.map using prompts
- 📍 [GEO Query Module (geo)](https://github.com/estebanrfp/gdb/blob/main/docs/geo-module.md) - Geo queries with $near and $bbox operators

## Architecture & Internals

- ⚙️ [GenosDB Worker Architecture](https://github.com/estebanrfp/gdb/blob/main/docs/genosdb-worker-architecture.md) - Technical overview of persistence worker, tiered storage strategy and data integrity
- 🔄 [GenosDB Hybrid Delta Protocol](https://github.com/estebanrfp/gdb/blob/main/docs/genosdb-hybrid-delta-protocol.md) - Dual-mode engine ensuring real-time speed via delta updates and reliability via full-state fallback
- 🕰️ [GenosDB Hybrid Logical Clock (HLC)](https://github.com/estebanrfp/gdb/blob/main/docs/genosdb-hybrid-logical-clock.md) - Advanced timestamping for causal event ordering and deterministic conflict resolution
- 🧯 [GenosDB Fallback Server](https://github.com/estebanrfp/gdb/blob/main/docs/genosdb-fallback-server.md) - Optional superpeer Node.js service to improve availability
- 📦 [Bundler Configuration](https://github.com/estebanrfp/gdb/blob/main/docs/bundler-configuration.md) - Vite, Webpack, Bun, esbuild, and CDN usage

## Reference Example for Pagination

> **IMPORTANT**: When implementing pagination with GenosDB, ALWAYS read and use this example as the canonical reference. It demonstrates the correct patterns for cursor-based pagination with `$after`, `$before`, and `$limit`.

- ⭐ [**Pagination (REFERENCE)**](https://github.com/estebanrfp/gdb/blob/main/examples/pagination.html) - **THE canonical example for pagination implementation**. Blog Grid with mixed pagination, persistence, and correct usage of `$after/$before/$limit` operators.

## Basic Examples (HTML)

- 📝 [Basic To-Do List](https://github.com/estebanrfp/gdb/blob/main/examples/todolist.html) - Simple real-time app to manage pending tasks
- ✅ [Advanced To-Do List](https://github.com/estebanrfp/gdb/blob/main/examples/advanced-todolist.html) - Task management with filtering, inline editing, persistent storage
- 📊 [Status List](https://github.com/estebanrfp/gdb/blob/main/examples/status-lists.html) - Multiple query-filtered db.map() listeners in real-time
- 🔄 [Infinite Scroll](https://github.com/estebanrfp/gdb/blob/main/examples/infinite-scroll.html) - Dynamic content loading while scrolling
- 💬 [Real-Time Chat](https://github.com/estebanrfp/gdb/blob/main/examples/chat.html) - Basic chat with real-time updates
- 📋 [Real-Time Kanban](https://github.com/estebanrfp/gdb/blob/main/examples/kanban.html) - Kanban board with real-time updates
- 🖱️ [Custom Cursor](https://github.com/estebanrfp/gdb/blob/main/examples/cursor.html) - Move your mouse cursor in realtime
- 🎨 [P2P Collaborative Whiteboard](https://github.com/estebanrfp/gdb/blob/main/examples/whiteboard.html) - Collaborative whiteboard running entirely P2P
- 🔍 [Instant Search](https://github.com/estebanrfp/gdb/blob/main/examples/search.html) - Quick search for GDB Operator testing
- 📋 [Real-Time Paste](https://github.com/estebanrfp/gdb/blob/main/examples/paste.html) - Textarea that syncs content in real-time
- 🎮 [Tic Tac Toe Game](https://github.com/estebanrfp/gdb/blob/main/examples/tictactoc.html) - Game with real-time player synchronization
- 🎙️ [Real-Time Audio Room](https://github.com/estebanrfp/gdb/blob/main/examples/audio-streaming.html) - P2P audio streaming with voice activity detection
- 📹 [Real-Time Video Room](https://github.com/estebanrfp/gdb/blob/main/examples/video-streaming.html) - P2P video streaming with webcam broadcasting
- 📁 [Real-Time File Streaming](https://github.com/estebanrfp/gdb/blob/main/examples/file-streaming.html) - P2P file streaming
- 📍 [Real-time Location Sharing](https://github.com/estebanrfp/gdb/blob/main/examples/share-locations.html) - Live location on map using Leaflet and GenosRTC
- 📝 [Collaborative Rich-Text Editor](https://github.com/estebanrfp/gdb/blob/main/examples/collab.html) - Live typing sync, remote cursors, RBAC + WebAuthn, version history
- 🔐 [Secure Decentralized Notes](https://github.com/estebanrfp/gdb/blob/main/examples/notesdev.html) - Decentralized identity, real-time sharing, full-text search
- 🌡️ [IoT Thermostat Control](https://github.com/estebanrfp/gdb/blob/main/examples/thermostat.html) - Real-time P2P thermostat demo with reactive sync
