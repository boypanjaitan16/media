# Changelog

## 0.1.0 (2026-11-20)

First public release.

### Features

* Attach files to Sequelize models in named collections, with polymorphic owners keyed by numeric id or UUID.
* Local, Google Cloud Storage and S3-compatible disks; SDKs load on first use.
* Per-collection rules: visibility, disk, `singleFile`, `acceptsMimeTypes` and `maxFileSize`.
* Responsive image conversions with sharp, plus helpers to backfill and retry them.
* Private media served through temporary signed URLs.
* Content-hashed file names and an immutable `Cache-Control` header for CDN-friendly collections.
* `createMediaTable` / `dropMediaTable` migration helpers.
* `matchesMimeSignature` magic-byte check for PDF, JPEG and PNG uploads.
