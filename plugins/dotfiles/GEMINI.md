# Dotfiles

Dotfiles management — chezmoi, fish shell, and environment configuration.

## Overview

This plugin provides the `chezmoi-dotfiles` skill: a general-purpose guide for
managing dotfiles with [chezmoi](https://chezmoi.io). It covers source-state
naming conventions, `.tmpl` templating, encryption and secret handling,
multi-environment (per-host/per-OS) support, and portable paths that resolve on
both macOS and Linux. It also ships reusable templates for file-watch sync and
macOS plist settings capture.

Use it when editing chezmoi-managed config, setting up a new machine, adding
encrypted secrets, troubleshooting template rendering, or adopting chezmoi for a
dotfiles repository.
