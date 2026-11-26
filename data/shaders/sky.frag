// Sky pass: procedural sky rendered behind the world (drawn after the world at
// far depth, so only uncovered pixels run this shader). Reconstructs the view
// ray from NDC and the camera basis. The shared radiance function is also used
// for water reflections.
// SDL GPU fragment uniform buffers live in set 3.

#version 450
#extension GL_GOOGLE_include_directive : require

#include "sky3d.glsl"
#include "nightvision_presets.glsl"

layout(set = 3, binding = 0) uniform SkyUBO {
    vec4 cam_right;    // xyz = camera right basis
    vec4 cam_up;       // xyz = camera up basis
    vec4 cam_forward;  // xyz = camera forward basis
    vec4 sun_dir;      // xyz = direction toward the sun (world), w = daylight 0..1
    vec4 params;       // x = tan(fov/2), y = aspect, z = cloudiness, w = night vision
    vec4 wind;         // xy = cloud drift offset in noise space
    vec4 eye_pos;      // xyz = camera position in scene coordinates
    vec4 cloud_mapping; // xy = map origin, z = cloud height, w = cloud XY scale
};

layout(location = 0) in vec2 v_ndc;
layout(location = 0) out vec4 out_color;
layout(location = 1) out vec4 out_emissive;

void main()
{
    vec3 ray = normalize( cam_forward.xyz
                          + cam_right.xyz * ( v_ndc.x * params.x * params.y )
                          + cam_up.xyz * ( v_ndc.y * params.x ) );
    float daylight = clamp( sun_dir.w, 0.0, 1.0 );
    vec3 sun_emission;
    vec3 col = sky3d_radiance( ray, eye_pos.xyz, sun_dir.xyz, daylight, params.z,
                               wind.xy, cloud_mapping.xy, cloud_mapping.z, cloud_mapping.w,
                               sun_emission );

    // night vision goggles: the whole viewport turns green like 2D's map.
    // daylight takes the overexposed look, the same hand-over the map uses
    // (smooth_lighting::overexpose_start)
    if( params.w > 0.5 ) {
        col = mix( nightvision_rgb( col ), overexposed_rgb( col ),
                   smoothstep( 0.85, 1.0, daylight ) );
        sun_emission = vec3( 0.0 );
    }
    out_color = vec4( col, 1.0 );
    out_emissive = vec4( sun_emission, 0.0 );
}
