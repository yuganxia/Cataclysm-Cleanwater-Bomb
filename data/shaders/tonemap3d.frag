#version 450
#extension GL_GOOGLE_include_directive : require

#include "tonemap3d_grade.glsl"

layout(set = 2, binding = 0) uniform sampler2D hdr_tex;

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 out_color;

void main()
{
    vec4 color = texture( hdr_tex, v_uv );
    out_color = vec4( tonemap3d_present( color.rgb, v_uv ), color.a );
}
