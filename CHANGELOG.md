# Changelog

## 0.2.19

- Resources: ManualsLib link 404'd (guessed product URL). Now links the
  brand page plus a site-scoped search for the model

## 0.2.18

- Scan label: request an 8k context from Ollama per call and downscale the
  photo to 1280 px before sending — fixes `request exceeds the available
  context size (4096 tokens)` on phone photos and speeds up the read. The
  full-size original is still what gets attached

## 0.2.17

- Scan label: separate **Take photo** and **Upload photo** buttons, so an
  existing photo from the gallery or a file works too (previously the
  camera was forced on phones)

## 0.2.16

- **Scan label**: on the new/edit device form, photograph the rating plate
  and a local Ollama vision model reads manufacturer, model, serial,
  product type, electrical ratings and extras (refrigerant, BTU, …) into the
  form. Empty fields are filled, your existing values are never overwritten,
  category is suggested from the product type, specs land in Notes, and the
  photo is attached as "Rating label" on save
- New add-on options `ollama_url` and `ollama_model` (leave blank to hide the
  feature). Env `OLLAMA_URL` / `OLLAMA_MODEL` override them in dev

## 0.2.15

- **Resources** card on the device page: one-tap links to manual searches,
  ManualsLib, appliance/HVAC parts houses (RepairClinic, PartSelect,
  AppliancePartsPros, Encompass), manufacturer support and CPSC recalls,
  built from the device's manufacturer + model
- **Find manual**: search the web for a device's documentation, pick a hit,
  and the add-on downloads the PDF and files it as a `manual` attachment —
  or paste a direct URL. Content is validated as a real PDF, capped at the
  upload size limit, and the source URL is recorded on the attachment
- Local build: `image:` removed from `config.yaml` so the Supervisor builds
  from source (upstream's prebuilt ghcr.io image is private)

## 0.2.14

- Add-on repository packaging: DOCS.md with screenshots, icon/logo,
  CHANGELOG, `repository.yaml`; broaden description beyond electrical;
  switch sidebar icon to `mdi:floor-plan`

## 0.2.13

- Device thumbnails, HA/local badges, create-device-from-diagram

## 0.2.12

- Bump to Jest 30, more icons and connection types, improved pickers

## 0.2.11

- Lots of diagram improvements

## 0.2.10

- Improve diagram, connection creation, etc.

## 0.2.9

- More diagram improvements

## 0.2.8

- Unify connection type across diagram and entities

## 0.2.7

- Improve diagram tooling

## 0.2.6

- Add floor handling, improve mobile layout

## 0.2.5

- Fix install and deploy

## 0.2.4

- Make build more robust

## 0.2.1 – 0.2.3

- Early install/deploy fixes
