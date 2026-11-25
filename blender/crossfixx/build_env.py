"""Render the studio environment map used for reflections in the CrossFixx explainer.

    blender -b -P blender/crossfixx/build_env.py
    python blender/crossfixx/build_env.py            # with `pip install bpy`

Writes src/crossfixx/assets/studio.hdr: a 1024x512 equirectangular Radiance HDR of a dark
photo studio with soft boxes. It only feeds reflections and ambient light (scene.environment);
the visible background stays the page's dark colour. Move or recolour the boxes in SOFTBOXES
to change the highlights on the metal parts.
"""
import math
import os

import bpy  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'src', 'crossfixx', 'assets', 'studio.hdr'))

# (name, Three.js-style direction (x, y, z) toward the box, size (w, h), strength, colour)
# Three (x, y, z) = Blender (x, -z, y); the camera looks from +Z (front-right).
SOFTBOXES = [
    ('key', (0.45, 0.85, 0.55), (5.0, 3.0), 9.0, (1.0, 0.97, 0.92)),     # large overhead key, front right
    ('fill', (-0.9, 0.25, 0.45), (2.0, 5.0), 2.2, (0.85, 0.92, 1.0)),    # tall strip, left
    ('rim', (-0.3, 0.35, -0.9), (6.0, 1.2), 4.5, (0.62, 0.78, 1.0)),     # cool strip behind
    ('kick', (0.95, 0.1, -0.3), (1.0, 4.0), 3.0, (1.0, 0.78, 0.55)),     # warm edge light, right
    ('top', (0.0, 1.0, 0.0), (3.0, 3.0), 2.5, (1.0, 1.0, 1.0)),          # ceiling panel
    ('front', (0.35, 0.3, 1.0), (9.0, 4.0), 0.9, (0.9, 0.93, 1.0)),      # broad dim panel behind the camera
    ('floor', (0.0, -1.0, 0.25), (8.0, 8.0), 0.12, (0.6, 0.65, 0.75)),   # faint floor bounce
]


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = 64
    s.cycles.max_bounces = 0
    s.render.resolution_x, s.render.resolution_y = 1024, 512
    s.render.image_settings.file_format = 'HDR'
    s.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('World')
    s.world = world
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.02, 0.023, 0.03, 1)
    bg.inputs['Strength'].default_value = 1.0

    cam_data = bpy.data.cameras.new('pano')
    cam_data.type = 'PANO'
    if hasattr(cam_data, 'panorama_type'):
        cam_data.panorama_type = 'EQUIRECTANGULAR'
    else:  # Blender < 4.0
        cam_data.cycles.panorama_type = 'EQUIRECTANGULAR'
    cam = bpy.data.objects.new('pano', cam_data)
    # Equirect camera looks along Blender +X at its centre column; rotate so the map is centred
    # on Three.js -Z, matching what RGBELoader + EquirectangularReflectionMapping expect.
    cam.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
    s.collection.objects.link(cam)
    s.camera = cam

    for name, d, (w, h), strength, col in SOFTBOXES:
        x, y, z = d
        n = math.sqrt(x * x + y * y + z * z)
        dist = 10.0
        loc = (x / n * dist, -z / n * dist, y / n * dist)
        bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
        p = bpy.context.active_object
        p.name = name
        p.scale = (w, h, 1)
        # face the plane toward the origin
        direction = -__import__('mathutils').Vector(loc)
        p.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
        m = bpy.data.materials.new(name)
        if bpy.app.version < (5, 0, 0):
            m.use_nodes = True
        nt = m.node_tree
        for node in list(nt.nodes):
            if node.type != 'OUTPUT_MATERIAL':
                nt.nodes.remove(node)
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = (*col, 1)
        em.inputs['Strength'].default_value = strength
        nt.links.new(em.outputs[0], nt.nodes['Material Output'].inputs['Surface'])
        p.data.materials.append(m)

    s.render.filepath = OUT
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'kB')


main()
