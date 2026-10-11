# Design

## Approved direction
Light street atlas for people outdoors in Delhi during daylight. Original bold condensed branding, readable system-font UI. Restrained off-white neutrals; soft amber-to-crimson gradient hotspots for 1–5 star incident ratings, teal refuges, blue route lines. Hotspots fade within the existing zone footprint; numeric star labels and explicit Pending labels preserve meaning without relying on color. Overlapping map badges group by projected screen space. Count badges reveal individual severity or Pending labels as space permits; tapping dense groups zooms progressively around the tapped badge. Labels retain 44px touch targets. Zone outlines are hidden; stronger gradient cores fade toward the zone edge. Dark ink text. Opaque panels and visible focus rings.

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
