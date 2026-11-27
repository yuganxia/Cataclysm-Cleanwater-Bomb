#version 450
#extension GL_GOOGLE_include_directive : require

#include "tonemap3d_grade.glsl"

layout(set = 2, binding = 0) uniform sampler2D hdr_tex;
layout(set = 2, binding = 1) uniform sampler2D bloom0_tex;
layout(set = 2, binding = 2) uniform sampler2D bloom1_tex;
layout(set = 2, binding = 3) uniform sampler2D bloom2_tex;
layout(set = 2, binding = 4) uniform sampler2D bloom3_tex;
layout(set = 2, binding = 5) uniform sampler2D bloom4_tex;

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 out_color;

void main()
{
    vec4 color = texture( hdr_tex, v_uv );
    vec3 bloom = texture( bloom0_tex, v_uv ).rgb * 0.34 +
                 texture( bloom1_tex, v_uv ).rgb * 0.26 +
                 texture( bloom2_tex, v_uv ).rgb * 0.19 +
                 texture( bloom3_tex, v_uv ).rgb * 0.13 +
                 texture( bloom4_tex, v_uv ).rgb * 0.08;
    vec3 hdr = max( color.rgb, vec3( 0.0 ) ) + max( bloom, vec3( 0.0 ) ) * 0.22;
    out_color = vec4( tonemap3d_present( hdr, v_uv ), color.a );
}
