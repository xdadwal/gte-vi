# Design

## Approved direction
Light street atlas for people outdoors in Delhi during daylight. Original bold condensed branding, readable system-font UI. Restrained off-white neutrals; soft amber-to-crimson gradient hotspots for 1–5 star incident ratings, teal refuges, blue route lines. Hotspots fade within the existing zone footprint; numeric star labels and explicit Pending labels preserve meaning without relying on color. Each loaded reported area keeps an individual severity or Pending label at every zoom level, without count grouping. Badge surfaces are 30% smaller than the earlier cards at zoom 14+, and shrink further when zoomed out. Labels retain 44px touch targets; gradients and zone footprints do not scale with badge sizing. Zone outlines are hidden; stronger gradient cores fade toward the zone edge. Dark ink text. Opaque panels and visible focus rings.

## Public layout
Full-height map. Compact header with original Grand Theft Elections wordmark with white, dark outlines and a warm coral accent and live state. Desktop left panel; mobile bottom sheet. Report and Find refuge remain reachable. No hero or marketing page. Brand lettering uses the licensed Barlow Condensed font, generous line spacing and a shared three-line lockup without a numeral. Colour inspiration comes from [GTA artwork](https://www.rockstargames.com/VI/media/artwork-wallpapers); no Rockstar logo or media is bundled.

## Reporting
Report → select 1–5 stars → hold 3 seconds. No preselection or extra confirmation. Selecting a rating reveals brief guidance: 1 checkposts with fewer than 5 personnel, 2 active personnel, 3 detention ongoing, 4 manhandling and higher personnel count, 5 full-blown violence. Progress uses transform; releasing, focus loss, and pointer cancellation reset. Sending and acknowledgement are distinct.

## Alerts

Foreground proximity alerts keep a visible toast until Ack. Optional sound remains off by default; enabled alerts use a louder, alternating 12-second pulse. Ack stops sound and dismisses the toast. Turning sound off, hiding the tab or leaving the map stops playback. Audio is unlocked by user interaction, and blocked audio never queues stale alerts.

## Admin
Light, desktop-first side navigation: Live incidents, Refuges, Activity, Team access (owner only). Split list/map desktop, list/map tabs mobile. Inline action panels, explicit reasons, stable selection, unsaved-change warning.

## Shape approval
Public layout and admin layout explicitly approved in conversation. Fidelity: working production application. Visual direction probe already resolved by approved wireframes and street-atlas direction. North-star artwork is optional reference and cannot change the approved flow.

The public map requests location on load, centers on the first successful fix, and follows subsequent location updates while preserving zoom. Manual panning does not disable following. If location is unavailable or denied, the configured Delhi view remains available. Admin map behavior is unchanged.

Refresh map and Locate me share a compact map-action row with 44px touch targets. Refresh fetches the current area and reconnects live updates without changing the camera; loading disables duplicate taps, and failure retains existing data with a retry message.
