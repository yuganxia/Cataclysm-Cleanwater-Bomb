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
    vec4 height_mapping;
};

#include "heightfield3d.glsl"

void main()
{
    int grid_size = textureSize( height_tex, 0 ).x;
    ivec2 vertex = ivec2( gl_VertexIndex % grid_size, gl_VertexIndex / grid_size );
    vec2 world_xy = vec2( vertex ) + height_mapping.xy;
    vec3 world = vec3( world_xy, height_mapping.z + terrain_height_at( world_xy ) );
    gl_Position = mvp * vec4( world, 1.0 );
}
