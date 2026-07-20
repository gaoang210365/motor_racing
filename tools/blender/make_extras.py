"""
Headless Blender generator for open-world EXTRAS (Phase 3):
grass tufts, several flower species, a gas station, and a driver character.

Run:  blender --background --python tools/blender/make_extras.py

Same conventions as make_props.py: single joined mesh per prop, COLOR_0 as the
active-render colour attribute, exported Y-up GLB into src/models/, origin at
the base so instances sit on the terrain at y = groundHeight.
"""
import bpy, bmesh, math, os
from mathutils import Vector

OUT_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "src", "models"))
os.makedirs(OUT_DIR, exist_ok=True)


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)


def new_mesh_obj(name):
    me = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    return obj


def set_vertex_color(obj, rgb):
    me = obj.data
    if not me.color_attributes:
        me.color_attributes.new(name="Col", type="BYTE_COLOR", domain="CORNER")
    ca = me.color_attributes[0]
    r, g, b = rgb
    for d in ca.data:
        d.color = (r, g, b, 1.0)


def join(parts, name):
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o


def clean_color_attrs(obj):
    me = obj.data
    cas = me.color_attributes
    keeper = None
    for ca in cas:
        allwhite = all(abs(d.color[0] - 1) < 0.02 and abs(d.color[1] - 1) < 0.02
                       and abs(d.color[2] - 1) < 0.02 for d in ca.data)
        if not allwhite:
            keeper = ca.name; break
    if keeper is None and len(cas):
        keeper = cas[0].name
    for ca in list(cas):
        if ca.name != keeper:
            cas.remove(ca)
    if keeper:
        idx = cas.find(keeper)
        if idx >= 0:
            cas.active_color_index = idx
            try: cas.render_color_index = idx
            except Exception: pass


def export(obj, name):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    clean_color_attrs(obj)
    mat = bpy.data.materials.new("vc"); mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Roughness"].default_value = 1.0
        bsdf.inputs["Metallic"].default_value = 0.0
    obj.data.materials.clear(); obj.data.materials.append(mat)
    path = os.path.join(OUT_DIR, name + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True,
        export_yup=True, export_apply=True, export_vertex_color="ACTIVE",
    )
    print(f"EXPORTED {name}.glb")
# ---- primitive helpers (each returns a coloured object) ----
def prim_cone(name, r1, r2, depth, z, seg, rgb, taper_to=None):
    o = new_mesh_obj(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=depth)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, z + depth / 2))
    bm.to_mesh(o.data); bm.free()
    set_vertex_color(o, rgb)
    return o


def prim_uv(name, r, z, rings, segs, rgb, squash=1.0):
    o = new_mesh_obj(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    for v in bm.verts:
        v.co.z *= squash
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, z))
    bm.to_mesh(o.data); bm.free()
    set_vertex_color(o, rgb)
    return o


def prim_box(name, cx, cy, cz, sx, sy, sz, rgb):
    o = new_mesh_obj(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x = v.co.x * sx + cx
        v.co.y = v.co.y * sy + cy
        v.co.z = v.co.z * sz + cz
    bm.to_mesh(o.data); bm.free()
    set_vertex_color(o, rgb)
    return o


def blade(name, base_x, base_y, height, lean, width, rgb):
    """A single curved grass blade: a thin 4-segment strip that tapers + leans."""
    o = new_mesh_obj(name)
    bm = bmesh.new()
    segs = 4
    prev = None
    for i in range(segs + 1):
        t = i / segs
        w = width * (1 - t) * 0.5
        zx = base_x + lean * t * t
        zz = height * t
        v0 = bm.verts.new((zx - w, base_y, zz))
        v1 = bm.verts.new((zx + w, base_y, zz))
        if prev:
            try: bm.faces.new([prev[0], prev[1], v1, v0])
            except ValueError: pass
        prev = (v0, v1)
    bm.to_mesh(o.data); bm.free()
    set_vertex_color(o, rgb)
    return o


def make_grass():
    """A fuller tuft of ~13 curved blades in varied green tones + a couple of
    taller seed stalks, for a lusher look."""
    reset_scene()
    parts = []
    import random
    random.seed(3)
    for i in range(13):
        a = random.uniform(0, math.tau)
        r = random.uniform(0, 0.12)
        bx, by = math.cos(a) * r, math.sin(a) * r
        h = random.uniform(0.26, 0.52)
        lean = random.uniform(-0.16, 0.16)
        # tonal variation across yellow-green -> deep green
        g = 0.40 + random.uniform(-0.08, 0.12)
        rr = 0.16 + random.uniform(0, 0.10)
        b = blade(f"bl{i}", bx, by, h, lean, random.uniform(0.04, 0.06), (rr, g, 0.14))
        b.rotation_euler[2] = a
        bpy.context.view_layer.objects.active = b
        bpy.ops.object.transform_apply(rotation=True)
        parts.append(b)
    # two taller seed stalks with a small tip
    for i in range(2):
        a = random.uniform(0, math.tau)
        bx, by = math.cos(a) * 0.03, math.sin(a) * 0.03
        st = prim_cone(f"stalk{i}", 0.012, 0.008, 0.62, 0, 4, (0.55, 0.55, 0.30))
        st.location.x = bx; st.location.y = by
        bpy.context.view_layer.objects.active = st
        bpy.ops.object.transform_apply(location=True)
        parts.append(st)
        tip = prim_uv(f"seed{i}", 0.03, 0.6, 3, 5, (0.72, 0.66, 0.32), squash=1.6)
        tip.location.x = bx; tip.location.y = by
        bpy.context.view_layer.objects.active = tip
        bpy.ops.object.transform_apply(location=True)
        parts.append(tip)
    return join(parts, "grass")


def make_lamp():
    """A street lamp: base, fluted pole, a curved cantilever arm and a dark
    lantern hood. The glowing head is added in-game (emissive, switches on at
    night). Origin at the base; faces so the arm reaches toward +x."""
    reset_scene()
    parts = []
    dark = (0.16, 0.17, 0.20)
    metal = (0.28, 0.30, 0.34)
    # base + fluted pole
    parts.append(prim_cone("base", 0.32, 0.24, 0.5, 0, 10, dark))
    parts.append(prim_cone("pole", 0.13, 0.09, 5.0, 0.45, 10, metal))
    parts.append(prim_cone("collar", 0.17, 0.13, 0.28, 4.7, 10, dark))
    # curved cantilever arm made of short segments sweeping up then over +x
    import math as _m
    px, pz = 0.0, 5.1
    seg_pts = [(0.0, 5.1), (0.45, 5.45), (0.95, 5.62), (1.2, 5.55)]
    for i in range(len(seg_pts) - 1):
        x0, z0 = seg_pts[i]; x1, z1 = seg_pts[i + 1]
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        dx, dz = x1 - x0, z1 - z0
        length = _m.hypot(dx, dz)
        seg = prim_cone(f"arm{i}", 0.07, 0.06, length, 0, 8, metal)
        # orient the segment along (dx,dz): rotate about Y
        seg.rotation_euler[1] = _m.atan2(dx, dz)
        seg.location = (cx, 0, cz - length / 2 * 0)  # cone is centered via z offset below
        # place: cone built along +z from origin; shift to segment midpoint
        seg.location = (cx - dx / 2, 0, cz - dz / 2)
        seg.rotation_euler[1] = _m.atan2(dx, dz)
        bpy.context.view_layer.objects.active = seg
        bpy.ops.object.transform_apply(location=True, rotation=True)
        parts.append(seg)
    # lantern hood at the arm tip (~x=1.2, z=5.5)
    parts.append(prim_box("hood", 1.2, 0, 5.42, 0.34, 0.34, 0.14, dark))
    return join(parts, "lamp")
def _stem_and_leaves(parts, top_z):
    parts.append(prim_cone("stem", 0.018, 0.012, top_z, 0, 5, (0.22, 0.5, 0.18)))
    # two little leaves
    for s in (-1, 1):
        lf = prim_uv("leaf", 0.06, top_z * 0.45, 3, 6, (0.24, 0.55, 0.2), squash=0.35)
        lf.scale = (1.6, 0.5, 0.4)
        lf.location.x = s * 0.05
        bpy.context.view_layer.objects.active = lf
        bpy.ops.object.transform_apply(scale=True, location=True)
        parts.append(lf)


def make_flower_daisy():
    """White petals around a yellow disc on a stem."""
    reset_scene()
    parts = []
    top = 0.5
    _stem_and_leaves(parts, top)
    # petals: flattened spheres in a ring
    for i in range(8):
        a = i / 8 * math.tau
        p = prim_uv(f"pet{i}", 0.11, top, 3, 6, (0.95, 0.95, 0.97), squash=0.22)
        p.scale = (1.8, 0.7, 0.35)
        p.location = (math.cos(a) * 0.13, math.sin(a) * 0.13, top)
        p.rotation_euler[2] = a
        bpy.context.view_layer.objects.active = p
        bpy.ops.object.transform_apply(scale=True, location=True, rotation=True)
        parts.append(p)
    parts.append(prim_uv("core", 0.08, top + 0.01, 4, 8, (0.95, 0.8, 0.2), squash=0.5))
    return join(parts, "flower_daisy")


def make_flower_tulip():
    """A cupped red/pink bloom (6 upright petals) on a tall stem."""
    reset_scene()
    parts = []
    top = 0.62
    _stem_and_leaves(parts, top)
    for i in range(6):
        a = i / 6 * math.tau
        p = prim_uv(f"pet{i}", 0.1, top + 0.06, 4, 6, (0.86, 0.16, 0.32), squash=0.9)
        p.scale = (0.55, 0.55, 1.3)
        p.location = (math.cos(a) * 0.06, math.sin(a) * 0.06, top + 0.06)
        p.rotation_euler[0] = 0.32
        p.rotation_euler[2] = a
        bpy.context.view_layer.objects.active = p
        bpy.ops.object.transform_apply(scale=True, location=True, rotation=True)
        parts.append(p)
    return join(parts, "flower_tulip")


def make_flower_bluebell():
    """A cluster of small blue bell blooms on a slender stem."""
    reset_scene()
    parts = []
    top = 0.55
    _stem_and_leaves(parts, top)
    import random
    random.seed(9)
    for i in range(5):
        z = top - i * 0.07
        off = 0.05 + i * 0.006
        b = prim_cone(f"bell{i}", 0.055, 0.02, 0.09, z, 6, (0.32, 0.36, 0.86))
        b.location.x = off
        bpy.context.view_layer.objects.active = b
        bpy.ops.object.transform_apply(location=True)
        parts.append(b)
    return join(parts, "flower_bluebell")


def make_gas_station():
    """A tidy fuel station: canopy on 4 pillars, two pumps, a small shop."""
    reset_scene()
    parts = []
    # canopy slab
    parts.append(prim_box("canopy", 0, 0, 5.0, 11, 6, 0.5, (0.92, 0.94, 0.97)))
    parts.append(prim_box("canopyband", 0, 0, 4.7, 11.05, 6.05, 0.18, (0.85, 0.20, 0.16)))
    # 4 pillars
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(prim_box(f"pil{sx}{sy}", sx * 4.6, sy * 2.4, 2.4, 0.35, 0.35, 4.8, (0.8, 0.82, 0.85)))
    # two pumps
    for sx in (-1, 1):
        parts.append(prim_box(f"pump{sx}", sx * 2.2, 0, 0.9, 0.7, 1.2, 1.8, (0.90, 0.32, 0.12)))
        parts.append(prim_box(f"pumptop{sx}", sx * 2.2, 0, 1.95, 0.72, 1.22, 0.35, (0.15, 0.16, 0.18)))
    # shop building behind
    parts.append(prim_box("shop", 0, -6.2, 1.9, 7, 3.5, 3.8, (0.86, 0.83, 0.72)))
    parts.append(prim_box("shoproof", 0, -6.2, 3.95, 7.3, 3.8, 0.4, (0.55, 0.16, 0.14)))
    parts.append(prim_box("door", 0, -4.35, 1.4, 1.2, 0.15, 2.6, (0.3, 0.45, 0.6)))
    for sx in (-1, 1):
        parts.append(prim_box(f"win{sx}", sx * 2.2, -4.35, 2.0, 1.6, 0.12, 1.4, (0.45, 0.62, 0.78)))
    return join(parts, "gas_station")


def make_character():
    """A stylized racing driver: helmet, torso in team-ish suit, arms, legs.
    Origin at the feet so it stands on the terrain."""
    reset_scene()
    parts = []
    suit = (0.16, 0.28, 0.62)
    suit2 = (0.9, 0.85, 0.2)
    skin = (0.82, 0.62, 0.5)
    # legs
    for sx in (-1, 1):
        parts.append(prim_box(f"leg{sx}", sx * 0.11, 0, 0.42, 0.16, 0.2, 0.84, suit))
        parts.append(prim_box(f"boot{sx}", sx * 0.11, 0.05, 0.05, 0.18, 0.30, 0.14, (0.1, 0.1, 0.12)))
    # torso (tapered box via two stacked)
    parts.append(prim_box("hips", 0, 0, 0.95, 0.42, 0.26, 0.28, suit))
    parts.append(prim_box("chest", 0, 0, 1.28, 0.46, 0.28, 0.44, suit))
    parts.append(prim_box("chestband", 0, 0.001, 1.32, 0.47, 0.285, 0.14, suit2))
    # shoulders + arms
    for sx in (-1, 1):
        parts.append(prim_uv(f"sh{sx}", 0.14, 1.48, 4, 8, suit, squash=1))
        parts[-1].location.x = sx * 0.28
        bpy.context.view_layer.objects.active = parts[-1]; bpy.ops.object.transform_apply(location=True)
        parts.append(prim_box(f"arm{sx}", sx * 0.30, 0, 1.16, 0.14, 0.16, 0.5, suit))
        parts.append(prim_uv(f"hand{sx}", 0.075, 0.9, 4, 6, (0.12, 0.12, 0.14)))
        parts[-1].location.x = sx * 0.30
        bpy.context.view_layer.objects.active = parts[-1]; bpy.ops.object.transform_apply(location=True)
    # neck + helmet
    parts.append(prim_box("neck", 0, 0, 1.56, 0.14, 0.14, 0.1, skin))
    parts.append(prim_uv("helmet", 0.19, 1.74, 6, 10, (0.9, 0.2, 0.18), squash=1.05))
    # visor band
    vis = prim_box("visor", 0, 0.15, 1.75, 0.30, 0.12, 0.11, (0.1, 0.12, 0.16))
    parts.append(vis)
    return join(parts, "character")


for maker, nm in [
    (make_grass, "grass"),
    (make_flower_daisy, "flower_daisy"),
    (make_flower_tulip, "flower_tulip"),
    (make_flower_bluebell, "flower_bluebell"),
    (make_gas_station, "gas_station"),
    (make_lamp, "lamp"),
]:
    obj = maker()
    export(obj, nm)

print("ALL_EXTRAS_DONE")
