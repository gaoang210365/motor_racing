"""
Headless Blender prop generator for the open world (Phase 2).

Run:  blender --background --python tools/blender/make_props.py

Generates low-poly, vertex-coloured props and exports each as a .glb into
src/models/. Each prop is a single joined mesh with a COLOR_0 attribute so the
game can render many copies with one InstancedMesh (material vertexColors=true).

Design frame: +Z up in Blender; we rotate to Y-up on export via the glTF
exporter (yup=True default), so models arrive Y-up in three.js. Origin at the
base centre so instances sit on the terrain at y = groundHeight.
"""
import bpy, bmesh, math, os
from mathutils import Vector

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "src", "models")
OUT_DIR = os.path.normpath(OUT_DIR)
os.makedirs(OUT_DIR, exist_ok=True)


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)


def set_vertex_color(obj, rgb):
    """Bake a flat colour into a COLOR_0 attribute on every loop."""
    me = obj.data
    if not me.color_attributes:
        me.color_attributes.new(name="Col", type="BYTE_COLOR", domain="CORNER")
    ca = me.color_attributes[0]
    r, g, b = rgb
    for i in range(len(ca.data)):
        ca.data[i].color = (r, g, b, 1.0)


def add_box(bm, cx, cy, cz, sx, sy, sz):
    verts = []
    for dx in (-0.5, 0.5):
        for dy in (-0.5, 0.5):
            for dz in (-0.5, 0.5):
                verts.append(bm.verts.new((cx + dx * sx, cy + dy * sy, cz + dz * sz)))
    bm.verts.ensure_lookup_table()
    faces = [(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)]
    for f in faces:
        try: bm.faces.new([verts[i] for i in f])
        except ValueError: pass


def finalize(name, rgb):
    """Turn the active object into a coloured, exportable mesh."""
    obj = bpy.context.active_object
    obj.name = name
    set_vertex_color(obj, rgb)
    return obj
def join_selected(name):
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    return obj


def new_mesh_obj(name):
    me = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    return obj


def make_tree():
    """A stylized pine: tapered trunk + three stacked cones. Vertex-coloured
    per part by building separate bmeshes and joining."""
    reset_scene()
    parts = []
    # trunk
    o = new_mesh_obj("trunk")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.28, radius2=0.20, depth=2.2)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, 1.1))
    bm.to_mesh(o.data); bm.free()
    set_vertex_color(o, (0.36, 0.26, 0.16)); parts.append(o)
    # canopy cones
    for i, (z, r, h) in enumerate([(2.0, 1.9, 2.4), (3.3, 1.4, 2.0), (4.4, 0.9, 1.7)]):
        o = new_mesh_obj(f"canopy{i}")
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=r, radius2=0.02, depth=h)
        bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, z + h / 2))
        bm.to_mesh(o.data); bm.free()
        shade = 0.20 + i * 0.03
        set_vertex_color(o, (0.16 + shade * 0.3, 0.42 + shade, 0.18 + shade * 0.2)); parts.append(o)
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts: p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    obj = join_selected("tree")
    return obj, 1.6  # collider radius (metres)


def make_rock():
    reset_scene()
    o = new_mesh_obj("rock")
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
    for v in bm.verts:  # jitter for a craggy look
        v.co += Vector((math.sin(v.co.x * 9) * 0.12, math.sin(v.co.y * 7) * 0.12, math.sin(v.co.z * 8) * 0.1))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, 0.5))
    bm.to_mesh(o.data); bm.free()
    set_vertex_color(o, (0.44, 0.41, 0.36))
    return o, 1.0


def make_barn():
    """A red barn: box body + gable roof."""
    reset_scene()
    parts = []
    o = new_mesh_obj("body")
    bm = bmesh.new(); add_box(bm, 0, 0, 2.0, 7, 5, 4.0); bm.to_mesh(o.data); bm.free()
    set_vertex_color(o, (0.55, 0.13, 0.11)); parts.append(o)
    # roof (prism)
    o = new_mesh_obj("roof")
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in [(-3.7,-2.7,4.0),(-3.7,2.7,4.0),(3.7,-2.7,4.0),(3.7,2.7,4.0),(-3.7,0,5.8),(3.7,0,5.8)]]
    bm.faces.new([v[0],v[1],v[4]]); bm.faces.new([v[2],v[5],v[3]])
    bm.faces.new([v[0],v[4],v[5],v[2]]); bm.faces.new([v[1],v[3],v[5],v[4]])
    bm.to_mesh(o.data); bm.free()
    set_vertex_color(o, (0.25, 0.22, 0.20)); parts.append(o)
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts: p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    return join_selected("barn"), 4.2


def make_silo():
    """A tall grain silo — a good long-range landmark."""
    reset_scene()
    parts = []
    o = new_mesh_obj("tube")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=2.2, radius2=2.2, depth=11)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, 5.5))
    bm.to_mesh(o.data); bm.free()
    set_vertex_color(o, (0.78, 0.80, 0.83)); parts.append(o)
    o = new_mesh_obj("dome")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=2.3, radius2=0.1, depth=2.2)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, 12.1))
    bm.to_mesh(o.data); bm.free()
    set_vertex_color(o, (0.55, 0.57, 0.60)); parts.append(o)
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts: p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    return join_selected("silo"), 2.6


def clean_color_attrs(obj):
    """Keep exactly one colour attribute (the one carrying real data) and mark
    it active + active-render, so the glTF exporter emits it as COLOR_0."""
    me = obj.data
    cas = me.color_attributes
    # find the attribute that isn't uniformly white
    keeper = None
    for ca in cas:
        allwhite = True
        for d in ca.data:
            c = d.color
            if abs(c[0] - 1) > 0.02 or abs(c[1] - 1) > 0.02 or abs(c[2] - 1) > 0.02:
                allwhite = False; break
        if not allwhite:
            keeper = ca.name; break
    if keeper is None and len(cas):
        keeper = cas[0].name
    # remove every other colour attribute
    for ca in list(cas):
        if ca.name != keeper:
            cas.remove(ca)
    # mark the survivor active + render-active
    if keeper:
        idx = cas.find(keeper)
        if idx >= 0:
            cas.active_color_index = idx
            try: cas.render_color_index = idx
            except Exception: pass


def export(obj, name, collider_r):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    clean_color_attrs(obj)
    # simple opaque material; the active-render colour attribute becomes COLOR_0
    mat = bpy.data.materials.new("vc"); mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Roughness"].default_value = 1.0
        bsdf.inputs["Metallic"].default_value = 0.0
    obj.data.materials.clear(); obj.data.materials.append(mat)
    path = os.path.join(OUT_DIR, name + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True,
        export_yup=True, export_apply=True, export_draco_mesh_compression_enable=False,
        export_vertex_color="ACTIVE",
    )
    print(f"EXPORTED {name}.glb  collider_r={collider_r}")


for maker, nm in [(make_tree, "tree"), (make_rock, "rock"), (make_barn, "barn"), (make_silo, "silo")]:
    obj, r = maker()
    export(obj, nm, r)

print("ALL_PROPS_DONE")
