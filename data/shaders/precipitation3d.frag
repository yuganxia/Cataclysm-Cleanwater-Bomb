#version 450
#extension GL_GOOGLE_include_directive : require

layout(set = 2, binding = 0) uniform sampler2D weather_mask_tex;

layout(set = 3, binding = 0) uniform PrecipFragUBO {
    mat4 view_proj;
    vec4 eye_pos;
    vec4 volume_center;
    vec4 volume_params;
    vec4 wind;
    vec4 precipitation;
    vec4 mask_mapping;
    vec4 cam_right;
    vec4 cam_up;
};

#include "weather3d.glsl"

layout(location = 0) in vec3 v_world;
layout(location = 1) in vec2 v_uv;
layout(location = 2) in float v_alpha;

layout(location = 0) out vec4 out_color;

void main()
{
    int mode = int( precipitation.z + 0.5 );
    float shape;
    if( mode == 0 ) {
        float edge = 1.0 - smoothstep( 0.45, 1.0, abs( v_uv.x * 2.0 - 1.0 ) );
        float ends = smoothstep( 0.0, 0.14, v_uv.y ) * ( 1.0 - smoothstep( 0.76, 1.0, v_uv.y ) );
        shape = edge * ends;
    } else {
        shape = 1.0 - smoothstep( 0.30, 1.0, length( v_uv * 2.0 - 1.0 ) );
    }
    float alpha = v_alpha * shape * weather_roof_exposure( v_world );
    if( alpha < 0.003 ) {
        discard;
    }
    float daylight = clamp( precipitation.w, 0.0, 1.0 );
    vec3 color = mode == 0
                 ? mix( vec3( 0.08, 0.10, 0.14 ), vec3( 0.58, 0.69, 0.82 ), daylight )
                 : mix( vec3( 0.20, 0.23, 0.29 ), vec3( 0.88, 0.93, 1.0 ), daylight );
    out_color = vec4( color, alpha );
}
