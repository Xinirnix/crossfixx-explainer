"""Build the CrossFixx explainer parts in Blender and export them as one GLB.

Run either way (Blender 4.2+ / bpy 4.2+; tested with bpy 5.3):
    blender -b -P blender/crossfixx/build_parts.py
    python blender/crossfixx/build_parts.py          # with `pip install bpy`

Outputs (paths relative to the repo root):
    src/crossfixx/assets/crossfixx-parts.glb   loaded by src/crossfixx/scene.js
    blender/crossfixx/crossfixx-parts.blend    same scene, for editing by hand

Conventions
-----------
* 1 Blender unit = 1 mm, Z up, front = -Y. The glTF exporter converts to the Y-up frame of
  Three.js, so Three (x, y, z) = Blender (x, z, -y).  All dimensions below are written in
  *Three.js* coordinates and converted with `tb()`, so they line up 1:1 with the constants at
  the top of src/crossfixx/scene.js (PLATE, TIP_R, ROD_R, ROTOR_R, ...). Change them together.
* Every part is parented to an empty named `G_<group>`. scene.js moves the children of each
  empty into the Three.js group with the same name (plateDeform, rodSlide, rotorSpin, ...),
  where main.js animates them live from the tip equation. Nothing here is animated.
* Material names are presets: scene.js swaps each for a tuned MeshPhysicalMaterial of the
  same name (text before any '.'), keeping only the baked ambient-occlusion map from here.
* Parts that never move relative to themselves get a baked AO texture (self-occlusion only).
"""
import math
import os
import sys

import bpy  # noqa: E402  (bpy must be imported before bmesh/mathutils when used as a module)
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
GLB_OUT = os.path.join(ROOT, 'src', 'crossfixx', 'assets', 'crossfixx-parts.glb')
BLEND_OUT = os.path.join(HERE, 'crossfixx-parts.blend')
BAKE_AO = '--no-ao' not in sys.argv
AO_SAMPLES = 48

# ---- Dimensions (mm), mirrored from src/crossfixx/scene.js ----
PLATE = 16.0
PLATE_T = 2.0
TIP_R = 1.3
TIP_H = 2.4
PLATE_CY = TIP_R + TIP_H + PLATE / 2          # 11.7
ROD_R = 3.5
STRIP_T = 0.8
STRIP_W = 4.2
ROTOR_R = 20.0
ROD_LEN = 400.0
ROD_Y = -STRIP_T - ROD_R + 0.9                 # rod axis height (-3.4)
Y_TOP = PLATE_CY + PLATE / 2 + 11              # underside of the housing top (30.7)
SPRING_Y0 = PLATE_CY + PLATE / 2 + 2.2         # spring seat on the yoke (21.9)
E_SIZE = PLATE / 2 - 1.4                       # electrode edge
E_OFF = E_SIZE / 2 + 0.9                       # electrode centre offset from plate centre

# Group origins in Three.js coordinates (assembled view). Must match scene.js.
GROUPS = {
    'frame': (0, 0, 0),
    'plateGroup': (0, PLATE_CY, 0),
    'plateDeform': (0, PLATE_CY, 0),
    'tip': (0, 0, 0),
    'stripSlide': (0, 0, 0),
    'rodSlide': (0, 0, 0),
    'linDriven': (0, 0, 0),
    'rotorSpin': (0, -ROTOR_R, 0),
    'rotorBody': (0, -ROTOR_R, 0),
    'rotDriven': (0, -ROTOR_R, 0),
}
COLLECTION_OF = {
    'frame': 'Motor', 'plateGroup': 'Motor', 'plateDeform': 'Motor', 'tip': 'Motor',
    'stripSlide': 'Linear', 'rodSlide': 'Linear', 'linDriven': 'Linear',
    'rotorSpin': 'Rotary', 'rotorBody': 'Rotary', 'rotDriven': 'Rotary',
}


def tb(v):
    """Three.js (x, y, z) -> Blender (x, y, z)."""
    x, y, z = v
    return Vector((x, -z, y))


# ---------------------------------------------------------------- scene setup
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = 'METRIC'
    s.unit_settings.scale_length = 0.001
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = AO_SAMPLES
    world = bpy.data.worlds.new('World')
    s.world = world
    world.light_settings.distance = 4.0  # AO reach in mm
    for name in ('Motor', 'Linear', 'Rotary'):
        c = bpy.data.collections.new(name)
        s.collection.children.link(c)


# Base colours here only matter for previews in Blender; scene.js owns the final look.
PRESETS = {
    'piezo': ((0.36, 0.34, 0.31), 0.0, 0.6),
    'electrode': ((0.80, 0.81, 0.83), 1.0, 0.35),
    'solder': ((0.75, 0.77, 0.80), 1.0, 0.15),
    'ceramic': ((0.92, 0.90, 0.86), 0.0, 0.3),
    'strip': ((0.88, 0.87, 0.84), 0.0, 0.35),
    'steel': ((0.62, 0.64, 0.67), 1.0, 0.18),
    'blackOxide': ((0.05, 0.05, 0.06), 0.8, 0.4),
    'anodized': ((0.06, 0.07, 0.09), 0.7, 0.42),
    'cut': ((0.70, 0.72, 0.75), 1.0, 0.3),
    'aluminium': ((0.58, 0.60, 0.63), 1.0, 0.32),
    'bronze': ((0.55, 0.40, 0.20), 1.0, 0.3),
    'mark': ((0.01, 0.01, 0.015), 0.3, 0.6),
    'accent': ((1.0, 0.45, 0.12), 0.0, 0.4),
    'rubber': ((0.03, 0.03, 0.03), 0.0, 0.8),
}


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    if bpy.app.version < (5, 0, 0):
        m.use_nodes = True
    base = name.split('.')[0]
    col, metal, rough = PRESETS[base]
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*col, 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    m.diffuse_color = (*col, 1)
    return m


def link(obj, group):
    coll = bpy.data.collections[COLLECTION_OF[group]]
    for c in obj.users_collection:
        c.objects.unlink(obj)
    coll.objects.link(obj)
    obj.parent = bpy.data.objects['G_' + group]
    return obj


def make_empties():
    for g, origin in GROUPS.items():
        e = bpy.data.objects.new('G_' + g, None)
        e.empty_display_size = 3
        e.location = tb(origin)
        bpy.data.collections[COLLECTION_OF[g]].objects.link(e)


def activate(obj):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)


def apply_mods(obj):
    activate(obj)
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def set_mat(obj, name):
    obj.data.materials.clear()
    obj.data.materials.append(material(name))
    return obj


def smooth(obj, angle=35):
    activate(obj)
    if hasattr(bpy.ops.object, 'shade_smooth_by_angle'):
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    else:  # Blender < 4.1
        bpy.ops.object.shade_smooth()
        obj.data.use_auto_smooth = True
        obj.data.auto_smooth_angle = math.radians(angle)
    return obj


# ---------------------------------------------------------------- primitives (Three.js coords)
def box(name, size, center, mat):
    sx, sy, sz = size
    bpy.ops.mesh.primitive_cube_add(size=1, location=tb(center))
    o = bpy.context.active_object
    o.name = name
    o.scale = (sx, sz, sy)
    activate(o)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
    return set_mat(o, mat)


def cyl(name, r, depth, center, axis, mat, verts=64, r2=None):
    """Cylinder (or cone if r2) along a Three.js axis 'x' | 'y' | 'z'."""
    rot = {'x': (0, math.pi / 2, 0), 'y': (0, 0, 0), 'z': (math.pi / 2, 0, 0)}[axis]
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=tb(center), rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=tb(center), rotation=rot)
    o = bpy.context.active_object
    o.name = name
    activate(o)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return set_mat(o, mat)


def boolean(target, cutter, op='DIFFERENCE', keep=False):
    m = target.modifiers.new('bool', 'BOOLEAN')
    m.operation = op
    m.object = cutter
    m.solver = 'EXACT'
    apply_mods(target)
    if not keep:
        bpy.data.objects.remove(cutter, do_unlink=True)
    return target


def bevel(obj, width, segments=2, angle=40):
    m = obj.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.harden_normals = False
    apply_mods(obj)
    return obj


def join(objs, name):
    activate(objs[0])
    for o in objs[1:]:
        o.select_set(True)
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o


def to_origin(obj, origin):
    """Shift an object built at its assembled world position into its group's local frame."""
    off = tb(origin)
    obj.data.transform(Matrix.Translation(-off))
    obj.location = (0, 0, 0)
    return obj


def lathe(name, profile, mat, segments=64, axis='y'):
    """Revolve a list of (radius, height) points around the Three.js Y axis."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for (r, h) in profile:
        ring = []
        n = 1 if r < 1e-6 else segments
        for i in range(n):
            a = 2 * math.pi * i / segments
            ring.append(bm.verts.new(tb((r * math.cos(a), h, r * math.sin(a)))))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        if len(r0) == 1 and len(r1) == 1:
            continue
        if len(r0) == 1:
            for i in range(segments):
                bm.faces.new((r0[0], r1[(i + 1) % segments], r1[i]))
        elif len(r1) == 1:
            for i in range(segments):
                bm.faces.new((r0[i], r0[(i + 1) % segments], r1[0]))
        else:
            for i in range(segments):
                j = (i + 1) % segments
                bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return set_mat(o, mat)


def rounded_rect(name, w, h, r, thick, center, mat, normal='z', seg=6):
    """Thin rounded rectangle in the Three.js XY plane (normal +Z), extruded by `thick`."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    cx, cy, cz = center
    front = [bm.verts.new(tb((cx + x, cy + y, cz + thick / 2))) for x, y in pts]
    back = [bm.verts.new(tb((cx + x, cy + y, cz - thick / 2))) for x, y in pts]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((back[i], back[j], front[j], front[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return set_mat(o, mat)


def socket_screw(name, center, axis, mat='blackOxide', r=1.0, h=0.9, sign=1):
    """Socket-head cap screw head; `sign` picks which way along `axis` the head faces."""
    head = cyl(name, r, h, center, axis, mat, verts=32)
    bevel(head, 0.12, 2)
    off = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1)}[axis]
    c = tuple(center[i] + off[i] * sign * h * 0.35 for i in range(3))
    hexcut = cyl(name + '_hex', r * 0.45, h * 0.5, c, axis, mat, verts=6)
    boolean(head, hexcut)
    return smooth(head)


def hex_nut(name, center, axis, mat='steel', r=1.8, h=1.2, bore=0.0):
    n = cyl(name, r, h, center, axis, mat, verts=6)
    bevel(n, 0.15, 1, angle=50)
    if bore:
        boolean(n, cyl(name + '_b', bore, h * 2, center, axis, mat, verts=24))
    return n


# ---------------------------------------------------------------- parts: motor
def build_frame():
    o = GROUPS['frame']
    yc = (Y_TOP + 2) / 2
    back = box('housing', (28, Y_TOP - 2, 1.2), (0, yc, -4.2), 'anodized')
    parts = [back,
             box('top', (28, 2, 9), (0, Y_TOP + 1, -0.2), 'anodized')]
    for sx in (-1, 1):
        parts.append(box('post', (1.2, Y_TOP - 2, 9), (sx * 13.4, yc, -0.2), 'anodized'))
    housing = join(parts, 'housing')
    activate(housing)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.001)
    bpy.ops.object.mode_set(mode='OBJECT')
    # Fuse the four boxes into one solid with a union against a tiny box (exact solver cleans it)
    seed = box('seed', (0.1, 0.1, 0.1), (0, Y_TOP + 1, -0.2), 'anodized')
    m = housing.modifiers.new('u', 'BOOLEAN')
    m.operation = 'UNION'
    m.object = seed
    m.solver = 'EXACT'
    m.use_self = True
    apply_mods(housing)
    bpy.data.objects.remove(seed, do_unlink=True)
    # Window in the back wall, so the light can reach the plate from behind
    win = rounded_rect('win', 16, 6, 1.2, 3, (0, Y_TOP - 6.2, -4.2), 'anodized')
    boolean(housing, win)
    bevel(housing, 0.35, 3)
    # Cutaway faces (front, z ≈ 4.3) show bare machined aluminium
    housing.data.materials.append(material('cut'))
    for p in housing.data.polygons:
        if p.normal.y < -0.9 and p.center.y < -4.2:  # Blender -Y is the Three.js front (+Z)
            p.material_index = 1
    smooth(housing)
    link(to_origin(housing, o), 'frame')

    # Fasteners on top: four cap screws and the preload lock nut on its threaded stud
    for sx in (-1, 1):
        for sz in (-1, 1):
            s = socket_screw('screw', (sx * 10.5, Y_TOP + 2.2, -0.2 + sz * 2.6), 'y', r=1.0, h=0.6)
            link(to_origin(s, o), 'frame')
    stud = cyl('preload_stud', 1.15, 3.2, (0, Y_TOP + 2.6, -0.2), 'y', 'steel', verts=32)
    bevel(stud, 0.2, 2)
    link(to_origin(smooth(stud), o), 'frame')
    nut = hex_nut('preload_nut', (0, Y_TOP + 2.6, -0.2), 'y', r=2.3, h=1.4, bore=1.2)
    link(to_origin(nut, o), 'frame')
    seat = lathe('spring_seat_top', [(0, Y_TOP), (3.4, Y_TOP), (3.4, Y_TOP - 0.5), (3.0, Y_TOP - 0.7), (0, Y_TOP - 0.7)], 'steel', 48)
    link(to_origin(smooth(seat), o), 'frame')

    # Preload spring: closed, ground ends (flat coils) with an open pitch in between.
    turns, r, wire = 8.0, 2.6, 0.38
    y0, y1 = SPRING_Y0 + wire, Y_TOP - 0.7 - wire
    curve = bpy.data.curves.new('spring', 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = wire
    curve.bevel_resolution = 4
    curve.use_fill_caps = True
    sp = curve.splines.new('POLY')
    n = int(turns * 48)
    sp.points.add(n)
    closed = 0.9  # turns at each end with pitch = wire diameter

    def height(t):
        a = t * turns
        dense = 2 * wire
        free = (y1 - y0 - 2 * closed * dense) / (turns - 2 * closed)
        if a < closed:
            return y0 + a * dense
        if a > turns - closed:
            return y1 - (turns - a) * dense
        return y0 + closed * dense + (a - closed) * free

    for i in range(n + 1):
        t = i / n
        a = t * turns * 2 * math.pi
        p = tb((r * math.cos(a), height(t), r * math.sin(a)))
        sp.points[i].co = (*p, 1)
    so = bpy.data.objects.new('spring', curve)
    bpy.context.scene.collection.objects.link(so)
    activate(so)
    bpy.ops.object.convert(target='MESH')
    so = bpy.context.active_object
    so.name = 'spring'
    set_mat(so, 'steel')
    link(to_origin(smooth(so, 60), o), 'frame')


def build_plate_group():
    o = GROUPS['plateGroup']
    cy = PLATE_CY
    # Yoke: one bracket from the clamp boss behind the plate up to the spring seat
    bar = box('bar', (3.2, PLATE / 2 + 2.2, 1.4), (0, cy + (PLATE / 2 + 2.2) / 2, -2.2), 'blackOxide')
    boss = cyl('boss', 2.6, 1.4, (0, cy, -2.2), 'z', 'blackOxide', verts=48)
    capp = box('cap', (7.4, 1.0, 7.4), (0, cy + PLATE / 2 + 2.2 - 0.1, -0.6), 'blackOxide')
    web = box('web', (1.2, 2.6, 4.2), (0, cy + PLATE / 2 + 0.9, -1.0), 'blackOxide')
    yoke = join([bar, boss, capp, web], 'yoke')
    seed = box('seed', (0.1, 0.1, 0.1), (0, cy + 3, -2.2), 'blackOxide')
    m = yoke.modifiers.new('u', 'BOOLEAN')
    m.operation = 'UNION'
    m.object = seed
    m.solver = 'EXACT'
    m.use_self = True
    apply_mods(yoke)
    bpy.data.objects.remove(seed, do_unlink=True)
    boolean(yoke, cyl('bore', 1.45, 4, (0, cy, -2.2), 'z', 'blackOxide', verts=32))
    bevel(yoke, 0.25, 3)
    link(to_origin(smooth(yoke), o), 'plateGroup')
    # Shoulder pin through the plate's nodal hole, with an elastomer washer and a nut behind
    pin = cyl('clamp_pin', 1.4, 6.0, (0, cy, -0.6), 'z', 'steel', verts=40)
    bevel(pin, 0.2, 2)
    link(to_origin(smooth(pin), o), 'plateGroup')
    head = lathe('clamp_head', [(0, 2.4), (1.6, 2.4), (1.9, 2.2), (1.95, 1.75), (1.95, 1.55), (0, 1.55)], 'steel', 48)
    head.data.transform(Matrix.Rotation(math.radians(90), 4, 'X'))  # lathe is around Y; turn to Z
    head.location = tb((0, cy, 0))
    activate(head)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    link(to_origin(smooth(head), o), 'plateGroup')
    washer = cyl('washer', 2.3, 0.3, (0, cy, 1.38), 'z', 'rubber', verts=48)
    boolean(washer, cyl('wb', 1.45, 1, (0, cy, 1.38), 'z', 'rubber', verts=32))
    link(to_origin(smooth(washer), o), 'plateGroup')
    nut = hex_nut('clamp_nut', (0, cy, -3.5), 'z', r=1.9, h=0.9, bore=1.4)
    link(to_origin(nut, o), 'plateGroup')
    seat = lathe('spring_seat', [(0, 0), (3.3, 0), (3.3, 0.45), (2.9, 0.6), (0, 0.6)], 'steel', 48)
    # The spring axis sits at z = 0; the seat rests on the yoke cap under it.
    seat.location = tb((0, SPRING_Y0 - 0.6, 0))
    activate(seat)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    link(to_origin(smooth(seat), o), 'plateGroup')


def build_plate_deform():
    o = GROUPS['plateDeform']
    cy = PLATE_CY
    plate = rounded_rect('piezo_plate', PLATE, PLATE, 0.35, PLATE_T, (0, cy, 0), 'piezo')
    boolean(plate, cyl('hole', 1.6, 4, (0, cy, 0), 'z', 'piezo', verts=48))
    bevel(plate, 0.15, 2)
    link(to_origin(smooth(plate), o), 'plateDeform')
    # Four fired-silver electrodes. Names carry the drive phase: diagonal pairs A and B.
    quads = [(-1, 1, 'A', 'TL'), (1, -1, 'A', 'BR'), (1, 1, 'B', 'TR'), (-1, -1, 'B', 'BL')]
    for qx, qy, ph, tag in quads:
        e = rounded_rect(f'electrode_{ph}_{tag}', E_SIZE, E_SIZE, 0.5, 0.08,
                         (qx * E_OFF, cy + qy * E_OFF, PLATE_T / 2 + 0.2), 'electrode')
        link(to_origin(e, o), 'plateDeform')
        # Solder joint near the outer corner, where the lead wire would attach
        d = lathe('solder', [(0, 0.22), (0.3, 0.13), (0.45, 0.0), (0, 0.0)], 'solder', 24)
        d.data.transform(Matrix.Rotation(math.radians(90), 4, 'X'))
        d.location = tb((qx * (E_OFF + E_SIZE / 2 - 1.1), cy + qy * (E_OFF + E_SIZE / 2 - 1.1), PLATE_T / 2 + 0.24))
        activate(d)
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
        link(to_origin(smooth(d, 80), o), 'plateDeform')


def build_tip():
    # Alumina tip: hemispherical contact end, straight shank, glue fillet into the plate.
    prof = []
    for i in range(0, 13):
        a = math.radians(90 * i / 12)
        prof.append((TIP_R * math.sin(a), TIP_R - TIP_R * math.cos(a)))
    top = PLATE_CY - PLATE / 2 - 0.15  # plate underside
    prof += [(TIP_R, top - 0.65)]
    for i in range(1, 7):
        a = math.radians(90 * i / 6)
        prof.append((TIP_R + 0.55 * (1 - math.cos(a)), top - 0.65 + 0.65 * math.sin(a)))
    prof += [(TIP_R, top + 0.4), (0, top + 0.4)]
    tip = lathe('tip', prof, 'ceramic', 64)
    link(smooth(tip, 50), 'tip')


# ---------------------------------------------------------------- parts: linear
def build_linear():
    # Ceramic strip with chamfered edges, and printed ticks every 10 mm (the rod wraps every 10 mm)
    strip = box('ceramic_strip', (ROD_LEN, STRIP_T, STRIP_W), (0, -STRIP_T / 2, 0), 'strip')
    bevel(strip, 0.12, 2)
    link(strip, 'stripSlide')
    tick = box('ticks', (0.5, 0.05, 1.2), (-ROD_LEN / 2 + 5, 0.012, 1.4), 'mark')
    arr = tick.modifiers.new('arr', 'ARRAY')
    arr.count = int(ROD_LEN / 10)
    arr.use_relative_offset = False
    arr.use_constant_offset = True
    arr.constant_offset_displace = (10, 0, 0)
    apply_mods(tick)
    link(tick, 'stripSlide')

    # Ground steel rod with a machined flat the strip is bonded to
    rod = cyl('rod', ROD_R, ROD_LEN, (0, ROD_Y, 0), 'x', 'steel', verts=96)
    boolean(rod, box('flat', (ROD_LEN + 2, 4, 10), (0, -STRIP_T + 2, 0), 'steel'))
    bevel(rod, 0.25, 2, angle=60)
    link(smooth(rod, 30), 'rodSlide')
    ring = cyl('scale_rings', ROD_R + 0.04, 0.7, (-ROD_LEN / 2 + 5, ROD_Y, 0), 'x', 'mark', verts=64)
    arr = ring.modifiers.new('arr', 'ARRAY')
    arr.count = int(ROD_LEN / 10)
    arr.use_relative_offset = False
    arr.use_constant_offset = True
    arr.constant_offset_displace = (10, 0, 0)
    apply_mods(ring)
    boolean(ring, box('flat2', (ROD_LEN + 4, 4, 10), (0, -STRIP_T + 2, 0), 'mark'))
    link(smooth(ring, 30), 'rodSlide')

    # Fixed bearing cradles with bronze liners, on a machine base plate
    for sx in (-1, 1):
        x = sx * 24
        c = box('cradle', (8, 8.4, 11), (x, -6.8, 0), 'anodized')
        flange = box('flange', (14, 1.6, 11), (x, -10.2, 0), 'anodized')
        c = join([c, flange], 'cradle')
        seed = box('seed', (0.1, 0.1, 0.1), (x, -7, 0), 'anodized')
        m = c.modifiers.new('u', 'BOOLEAN')
        m.operation = 'UNION'
        m.object = seed
        m.solver = 'EXACT'
        m.use_self = True
        apply_mods(c)
        bpy.data.objects.remove(seed, do_unlink=True)
        boolean(c, cyl('bore', ROD_R + 0.45, 12, (x, ROD_Y, 0), 'x', 'anodized', verts=64))
        bevel(c, 0.3, 3)
        link(smooth(c), 'linDriven')
        liner = cyl('liner', ROD_R + 0.45, 9.0, (x, ROD_Y, 0), 'x', 'bronze', verts=64)
        boolean(liner, cyl('lb', ROD_R + 0.05, 12, (x, ROD_Y, 0), 'x', 'bronze', verts=64))
        # open the top of the liner where the strip passes
        boolean(liner, box('lt', (12, 4, 4.8), (x, ROD_Y + 3.6, 0), 'bronze'))
        bevel(liner, 0.08, 1, angle=60)
        link(smooth(liner), 'linDriven')
        for fx in (-1, 1):
            s = socket_screw('screw', (x + fx * 5.3, -9.4 + 0.05, 0), 'y', r=0.85, h=0.6)
            link(s, 'linDriven')
    base = box('base_plate', (80, 1.6, 16), (0, -11.8, 0), 'anodized')
    bevel(base, 0.4, 3)
    link(smooth(base), 'linDriven')


# ---------------------------------------------------------------- parts: rotary
def build_rotary():
    o = GROUPS['rotorSpin']
    yc = -ROTOR_R
    band = cyl('ceramic_band', ROTOR_R, STRIP_W, (0, yc, 0), 'z', 'strip', verts=192)
    boolean(band, cyl('bi', ROTOR_R - STRIP_T, STRIP_W + 2, (0, yc, 0), 'z', 'strip', verts=192))
    bevel(band, 0.12, 2, angle=60)
    link(to_origin(smooth(band, 30), o), 'rotorSpin')

    # Machined aluminium rotor: rim, thin web with six lightening holes, hub
    prof = [(2.2, -2.5), (6.0, -2.5), (6.4, -2.1), (6.6, -1.0), (15.2, -1.0), (15.6, -2.1), (ROTOR_R - STRIP_T, -2.1),
            (ROTOR_R - STRIP_T, 2.1), (15.6, 2.1), (15.2, 1.0), (6.6, 1.0), (6.4, 2.1), (6.0, 2.5), (2.2, 2.5), (2.2, -2.5)]
    # lathe() revolves around Y; build around Y then turn the axis to Three.js Z.
    wheel = lathe('rotor', [(r, h) for r, h in prof], 'aluminium', 160)
    wheel.data.transform(Matrix.Rotation(math.radians(90), 4, 'X'))
    wheel.location = tb((0, yc, 0))
    activate(wheel)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    activate(wheel)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for i in range(6):
        a = 2 * math.pi * i / 6 + math.pi / 6
        boolean(wheel, cyl('lh', 3.0, 8, (math.cos(a) * 10.8, yc + math.sin(a) * 10.8, 0), 'z', 'aluminium', verts=48))
    bevel(wheel, 0.18, 2, angle=50)
    o2 = GROUPS['rotorBody']
    link(to_origin(smooth(wheel, 35), o2), 'rotorBody')
    # Index mark on the rim face, so a slow turn is visible
    mark = box('index_mark', (0.9, 2.4, 0.12), (0, yc + ROTOR_R - STRIP_T - 1.7, 2.16), 'accent')
    link(to_origin(mark, o2), 'rotorBody')
    for i in range(6):
        a = 2 * math.pi * i / 6
        s = socket_screw('hub_screw', (math.cos(a) * 4.4, yc + math.sin(a) * 4.4, 2.75), 'z', r=0.75, h=0.55)
        link(to_origin(s, o2), 'rotorBody')
    nut = hex_nut('axle_nut', (0, yc, 3.3), 'z', r=2.6, h=1.3, bore=1.4)
    link(to_origin(nut, o2), 'rotorBody')

    # Fixed: axle, bearing housing and a pedestal down to the floor (y = -46)
    o3 = GROUPS['rotDriven']
    axle = cyl('axle', 2.2, 12.5, (0, yc, -1.75), 'z', 'steel', verts=48)
    bevel(axle, 0.25, 2, angle=60)
    link(to_origin(smooth(axle), o3), 'rotDriven')
    bearing = cyl('bearing', 4.6, 2.6, (0, yc, -4.0), 'z', 'blackOxide', verts=64)
    bevel(bearing, 0.3, 2)
    link(to_origin(smooth(bearing), o3), 'rotDriven')
    ped_top = cyl('ped', 7.0, 2.4, (0, yc, -6.5), 'z', 'anodized', verts=96)
    ped_body = box('pedb', (14, 23, 2.4), (0, yc - 11.5, -6.5), 'anodized')
    rib = box('rib', (2.4, 20, 6), (0, yc - 13.8, -9.0), 'anodized')
    foot = box('foot', (34, 2.0, 18), (0, -45, -4.5), 'anodized')
    ped = join([ped_top, ped_body, rib, foot], 'pedestal')
    seed = box('seed', (0.1, 0.1, 0.1), (0, yc - 10, -6.5), 'anodized')
    m = ped.modifiers.new('u', 'BOOLEAN')
    m.operation = 'UNION'
    m.object = seed
    m.solver = 'EXACT'
    m.use_self = True
    apply_mods(ped)
    bpy.data.objects.remove(seed, do_unlink=True)
    bevel(ped, 0.4, 3)
    link(to_origin(smooth(ped), o3), 'rotDriven')
    for fx in (-1, 1):
        for fz in (-1, 1):
            s = socket_screw('foot_screw', (fx * 13, -43.7, -4.5 + fz * 6), 'y', r=0.95, h=0.6)
            link(to_origin(s, o3), 'rotDriven')


# ---------------------------------------------------------------- AO bake
AO_PARTS = {'housing': 1024, 'yoke': 512, 'cradle': 512, 'cradle.001': 512, 'base_plate': 512,
            'rotor': 1024, 'pedestal': 1024}


def occlusion_group():
    g = bpy.data.node_groups.get('glTF Material Output')
    if g:
        return g
    g = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    if hasattr(g, 'interface'):
        g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    else:
        g.inputs.new('NodeSocketFloat', 'Occlusion')
    return g


def bake_ao():
    renderables = [o for o in bpy.data.objects if o.type == 'MESH']
    for name, res in AO_PARTS.items():
        obj = bpy.data.objects.get(name)
        if not obj:
            print('AO: missing', name)
            continue
        # Own copy of each material, so the AO image is not shared with other parts
        for i, slot in enumerate(obj.material_slots):
            slot.material = slot.material.copy()
            slot.material.name = f'{slot.material.name.split(".")[0]}.{name.replace(".", "_")}'
        activate(obj)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.01)
        bpy.ops.object.mode_set(mode='OBJECT')
        img = bpy.data.images.new(f'ao_{name}', res, res)
        img.generated_color = (1, 1, 1, 1)
        for slot in obj.material_slots:
            nt = slot.material.node_tree
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = img
            sep = nt.nodes.new('ShaderNodeSeparateColor')
            nt.links.new(tex.outputs['Color'], sep.inputs['Color'])
            grp = nt.nodes.new('ShaderNodeGroup')
            grp.node_tree = occlusion_group()
            nt.links.new(sep.outputs[0], grp.inputs['Occlusion'])
            nt.nodes.active = tex
        for o in renderables:
            o.hide_render = o is not obj
        activate(obj)
        bpy.context.scene.render.bake.margin = 8
        bpy.ops.object.bake(type='AO')
        img.file_format = 'PNG'
        img.pack()
        print('AO baked', name)
    for o in renderables:
        o.hide_render = False


def main():
    reset()
    make_empties()
    build_frame()
    build_plate_group()
    build_plate_deform()
    build_tip()
    build_linear()
    build_rotary()
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.data.name = o.name
    if BAKE_AO:
        bake_ao()
    os.makedirs(os.path.dirname(GLB_OUT), exist_ok=True)
    for o in bpy.data.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=GLB_OUT, export_format='GLB', export_apply=True, export_yup=True,
        export_materials='EXPORT',
        export_image_format='JPEG', export_jpeg_quality=88,
    )
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT, compress=True)
    print('wrote', GLB_OUT, os.path.getsize(GLB_OUT) // 1024, 'kB')


main()
