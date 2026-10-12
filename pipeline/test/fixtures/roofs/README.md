# Roof input fixtures

The acquisition test defines a tiny EPT tree with an external hierarchy page, parent and
child nodes, and an excluded node. All bodies are synthetic. The Python tests create tiny
LAS 1.4 / point-format-6 LAZ files in temporary directories, with deliberately uncropped
original point positions; they retain original source ordinals after buffered cropping.
No real point cloud or aerial pixels are distributed in this fixture.

The three live coverage bounds are recorded in `pipeline/roofs/source-config.json`.
Source acquisition archives original EPT metadata, hierarchy pages and LAZ nodes without
rewriting their bytes. Aerial tiles remain disabled until permission is confirmed; exact
512-pixel XYZ zoom-19 tile transforms and individual tile coverage are retained when enabled.
