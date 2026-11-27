#version 450

layout(set = 2, binding = 0) uniform sampler2D atlas_tex;

layout(location = 1) in vec2 v_uv;
layout(location = 2) in float v_flags;

void main()
{
    int flags = int( v_flags + 0.5 );
    // Glass and other light-transmitting structural faces remain visible in
    // the main scene, but must not become opaque blockers in the depth map.
    if( ( flags & 65536 ) != 0 ) {
        discard;
    }
    if( ( flags & 128 ) != 0 ) {
        discard;
    }
    if( ( flags & 1 ) != 0 && ( flags & 2 ) == 0 &&
        texture( atlas_tex, v_uv ).a < 0.1 ) {
        discard;
    }
}
