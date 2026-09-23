# Changelog

## [0.5.1](https://github.com/kaykool/yt-distraction-free/compare/v0.5.0...v0.5.1) (2026-09-23)


### Bug Fixes

* never create video toggle observer without a target ([cd5e6d1](https://github.com/kaykool/yt-distraction-free/commit/cd5e6d1345d149d655d33e614a65b9b085e93b2c))
* never fall back to document.body in video toggle observer ([79f01d9](https://github.com/kaykool/yt-distraction-free/commit/79f01d9f2f40ca5e0bd88c59c219850eb2055cbf))
* scope the continuation click and legacy rule cleanup ([8e99b8e](https://github.com/kaykool/yt-distraction-free/commit/8e99b8e05492ba5739dd66393c696cc391ee18a1))
* stop overriding user playback quality and scope ad blocking to YouTube ([284be01](https://github.com/kaykool/yt-distraction-free/commit/284be01c64e66b4f4faad635257c7b29473b818c))
* stop running or blocking on YouTube subdomains ([6b79cb0](https://github.com/kaykool/yt-distraction-free/commit/6b79cb0faf0fe3d0b004452564cef3f375f9fb25))


### Performance Improvements

* add reproducible benchmark and live dom verifier ([d49402a](https://github.com/kaykool/yt-distraction-free/commit/d49402acd826763492205c8096dac353409003bb))
* prefer lifecycle payloads for live detection ([a9f4e3b](https://github.com/kaykool/yt-distraction-free/commit/a9f4e3ba56edbb53c6c468c688c9dc5bd2d41001))

## [0.5.0](https://github.com/kaykool/yt-distraction-free/compare/v0.4.0...v0.5.0) (2026-09-23)


### Features

* relabel block video button to AudioOnly with YouTube red/grey state colors ([95a35b3](https://github.com/kaykool/yt-distraction-free/commit/95a35b389116969a7917dbf025fb7d527b1efb71))


### Bug Fixes

* ship player.js and icons in release archive ([b3eeb0a](https://github.com/kaykool/yt-distraction-free/commit/b3eeb0ae37236d5088371438853c40e577c9063e))

## [0.4.0](https://github.com/kaykool/yt-distraction-free/compare/v0.3.1...v0.4.0) (2026-09-22)


### Features

* add block video toggle and preserve comments button when sidebar active ([3e4197b](https://github.com/kaykool/yt-distraction-free/commit/3e4197b2c055f25d5f2b955b3d083a7f09c076e0))
* enforce 144p/480p quality for block video toggle and coalesce sidebar updates ([f40272d](https://github.com/kaykool/yt-distraction-free/commit/f40272da7c9adc9411ba089affdfbc6c655e1b0c))

## [0.3.1](https://github.com/kaykool/yt-distraction-free/compare/v0.3.0...v0.3.1) (2026-09-11)


### Bug Fixes

* add Show chat button and collapse sidebar when live chat is closed ([0433d39](https://github.com/kaykool/yt-distraction-free/commit/0433d39eb5924abca3854f077067b9109808b45b))
* clamp skeleton player and container to prevent layout shift on load ([7578f94](https://github.com/kaykool/yt-distraction-free/commit/7578f9493bb0beec086869cc92d706c4f3f0e90c))
* mount live chat immediately and suppress comments button on live streams ([b86fdd0](https://github.com/kaykool/yt-distraction-free/commit/b86fdd0937a8ad1500e5f358c576997364dd4328))


### Performance Improvements

* cache live video detection and eliminate layout thrashing ([64a6e21](https://github.com/kaykool/yt-distraction-free/commit/64a6e215fd0ff97a2b53143d6df9fb21680ed9c7))
* optimize core lifecycle logic and streamline stylesheet ([aa15e1a](https://github.com/kaykool/yt-distraction-free/commit/aa15e1a8a25bd0f4ae04b62be9879992ba11bd16))

## [0.3.0](https://github.com/kaykool/yt-distraction-free/compare/v0.2.0...v0.3.0) (2026-09-10)


### Features

* add extension icons and register in manifest ([7e6e558](https://github.com/kaykool/yt-distraction-free/commit/7e6e55818f93ba13afca8ec898f32f123033a08a))

## [0.2.0](https://github.com/kaykool/yt-distraction-free/compare/v0.1.0...v0.2.0) (2026-09-10)


### Features

* hide ask, music, transcript, and channel links in description ([0d7e829](https://github.com/kaykool/yt-distraction-free/commit/0d7e8298251dd4083ebf783f0afb22325c55076a))
* hide event tickets, merchandise, and shopping shelves ([d7c55bc](https://github.com/kaykool/yt-distraction-free/commit/d7c55bca136978303a2f6ed0c3274d0a25042160))
