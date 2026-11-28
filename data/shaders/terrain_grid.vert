#version 450
#extension GL_GOOGLE_include_directive : require

layout(set = 0, binding = 0) uniform sampler2D height_tex;
layout(set = 1, binding = 0) uniform UBO {
    mat4 mvp;
    vec4 cam_right;
    vec4 cam_up;
    vec4 params;
    vec4 sun_dir;
    vec4 water_vertex;
    vec4 water_flow;
    vec4 height_mapping; // xy = grid origin, z = logical level base, w = enabled
};

#include "heightfield3d.glsl"

layout(location = 0) out vec4 v_color;
layout(location = 1) out vec2 v_uv;
layout(location = 2) out float v_flags;
layout(location = 3) out vec3 v_normal;
layout(location = 4) out vec3 v_world;
layout(location = 5) out vec2 v_screen;
layout(location = 6) out float v_wrap;
layout(location = 7) out vec3 v_tile;
layout(location = 8) out vec4 v_emission;
layout(location = 9) out float v_grid;

void main()
{
    int grid_size = textureSize( height_tex, 0 ).x;
    ivec2 vertex = ivec2( gl_VertexIndex % grid_size, gl_VertexIndex / grid_size );
    vec2 world_xy = vec2( vertex ) + height_mapping.xy;
    vec3 world = vec3( world_xy, height_mapping.z + terrain_height_at( world_xy ) );
    v_color = vec4( 1.0 );
    v_uv = fract( world_xy );
    v_flags = 0.0;
    v_normal = terrain_height_normal( world_xy );
    v_world = world;
    v_wrap = 0.0;
    v_tile = vec3( world_xy, height_mapping.z );
    v_emission = vec4( 0.0 );
    v_grid = 1.0;
    gl_Position = mvp * vec4( world, 1.0 );
    vec2 ndc = gl_Position.xy / gl_Position.w;
    v_screen = vec2( ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5 );
}
