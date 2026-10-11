# 250 m reporting grid

The user requested smaller zones: replace the 500 m reporting grid with 250 m EPSG:32643 squares. Keep alert radius choices and configured severity buffers unchanged. Routing graph tiles remain independently defined by their manifest, currently 500 m.

1. Update PostGIS cell lookup, incident geometry, and 2 km overview grouping. Add a transactional, idempotent schema migration that archives original legacy incidents and contributions, retires their cells, and emits removals without inventing source locations.
2. Update client cell lookup, markers, contours, same-cell report checks, and subscriptions. Increase detailed cell limits to 4,096 to cover the largest configurable radius and buffer. Make routing tile lookup use the manifest cell size.
3. Verify 250 m boundaries, adjacent subcells, geometry, archive preservation/idempotence, subscription coverage, and independent graph tile lookup. Run Go, frontend, and browser suites against the local graph.
4. Back up the development database, restart the matching application, document deployment coordination, and review the changes. Commit and push the feature branch and update PR #1; verify its current CI results.
