#version 450
#extension GL_GOOGLE_include_directive : require

#include "weather3d.glsl"

layout(set = 2, binding = 0) uniform sampler2D hdr_tex;
layout(set = 2, binding = 1) uniform sampler2D bloom_tex;

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 out_color;

void main()
{
    vec4 color = texture( hdr_tex, v_uv );
    vec3 rgb = max( color.rgb, vec3( 0.0 ) );
    rgb = weather3d_apply( rgb, v_uv );
    float peak = max( rgb.r, max( rgb.g, rgb.b ) );
    const float shoulder = 0.8;
    if( peak > shoulder ) {
        float mapped = shoulder + ( 1.0 - shoulder ) *
                       ( 1.0 - exp( -( peak - shoulder ) / ( 1.0 - shoulder ) ) );
        rgb *= mapped / peak;
    }
    out_color = vec4( rgb, color.a );
}
