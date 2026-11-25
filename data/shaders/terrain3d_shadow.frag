#version 450

layout(set = 2, binding = 0) uniform sampler2D atlas_tex;

layout(location = 1) in vec2 v_uv;
layout(location = 2) in float v_flags;

void main()
{
    int flags = int( v_flags + 0.5 );
    if( ( flags & 128 ) != 0 ) {
        discard;
    }
    if( ( flags & 1 ) != 0 && ( flags & 2 ) == 0 &&
        texture( atlas_tex, v_uv ).a < 0.1 ) {
        discard;
    }
}
