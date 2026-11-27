// Add visible local sun spill to the HDR scene. The roof mask confines surface
// lighting to interiors and the raw source limits double-lighting at the center
// of the direct-sun patch without erasing its luminous core.

#version 450
#extension GL_GOOGLE_include_directive : require

layout(set = 2, binding = 0) uniform sampler2D bounce_raw_tex;
layout(set = 2, binding = 1) uniform sampler2D bounce_blur_tex;
layout(set = 2, binding = 2) uniform sampler2D depth_tex;
layout(set = 2, binding = 3) uniform sampler2D weather_mask_tex;

layout(set = 3, binding = 0) uniform BounceApplyUBO {
    vec4 eye_pos;
    vec4 cam_right;
    vec4 cam_up;
    vec4 cam_forward;
    vec4 ray_params;   // x = tan(fov/2), y = aspect, z = near, w = far
    vec4 mask_mapping;
    vec4 bounce_params; // x = gain, y/z = distance fade start/end
};

#include "weather3d.glsl"

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 out_color;

float linear_depth( float depth )
{
    float zn = ray_params.z;
    float zf = ray_params.w;
    return zn * zf / max( zf - depth * ( zf - zn ), 1.0e-5 );
}

vec3 world_position( vec2 uv, float depth )
{
    vec2 ndc = vec2( uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0 );
    vec3 ray = cam_forward.xyz + cam_right.xyz * ( ndc.x * ray_params.x * ray_params.y ) +
               cam_up.xyz * ( ndc.y * ray_params.x );
    return eye_pos.xyz + ray * linear_depth( depth );
}

void main()
{
    ivec2 size = textureSize( depth_tex, 0 );
    ivec2 pixel = clamp( ivec2( v_uv * vec2( size ) ), ivec2( 0 ), size - 1 );
    float depth = texelFetch( depth_tex, pixel, 0 ).r;
    if( depth >= 0.999999 ) {
        out_color = vec4( 0.0 );
        return;
    }
    float view_depth = linear_depth( depth );
    vec3 world = world_position( v_uv, depth );
    float indoor = 1.0 - weather_roof_exposure( world );
    float distance_fade = 1.0 - smoothstep( bounce_params.y, bounce_params.z, view_depth );
    if( indoor <= 0.0 || distance_fade <= 0.0 ) {
        out_color = vec4( 0.0 );
        return;
    }

    vec3 raw = max( texture( bounce_raw_tex, v_uv ).rgb, vec3( 0.0 ) );
    vec3 blurred = max( texture( bounce_blur_tex, v_uv ).rgb, vec3( 0.0 ) );
    float direct_luma = dot( raw, vec3( 0.2126, 0.7152, 0.0722 ) );
    float shadow_weight = 1.0 - smoothstep( 0.02, 0.35, direct_luma );
    vec3 indirect = min( blurred, vec3( 3.0 ) ) * bounce_params.x * indoor *
                    distance_fade * mix( 0.45, 1.0, shadow_weight );
    out_color = vec4( indirect, 0.0 );
}
