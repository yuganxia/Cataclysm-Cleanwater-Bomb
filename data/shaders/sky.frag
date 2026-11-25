// Sky pass: procedural sky rendered behind the world (drawn after the world at
// far depth, so only uncovered pixels run this shader). Reconstructs the view
// ray from NDC and the camera basis, then paints a daylight-driven gradient,
// the sun disc (real azimuth/altitude from the game calendar), and fbm clouds
// drifting with the wind. Below the horizon: a dark void so the world edge
// never reads as sky.
// SDL GPU fragment uniform buffers live in set 3.

#version 450
#extension GL_GOOGLE_include_directive : require

#include "atmosphere3d.glsl"
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
    // NDC -> view ray, same basis convention as the world pass
    vec3 ray = normalize( cam_forward.xyz
                          + cam_right.xyz * ( v_ndc.x * params.x * params.y )
                          + cam_up.xyz * ( v_ndc.y * params.x ) );
    float daylight = clamp( sun_dir.w, 0.0, 1.0 );

    // gradient between horizon and zenith, keyed to daylight
    vec3 zenith = mix( vec3( 0.004, 0.005, 0.012 ), vec3( 0.22, 0.42, 0.75 ), daylight );
    vec3 horizon = atmosphere_horizon_color( daylight );
    vec3 col;
    if( ray.z >= 0.0 ) {
        col = mix( horizon, zenith, pow( ray.z, 0.6 ) );
    } else {
        vec3 voidc = vec3( 0.010, 0.010, 0.014 ) * ( 0.3 + 0.7 * daylight );
        col = mix( horizon, voidc, clamp( -ray.z * 6.0, 0.0, 1.0 ) );
    }

    // sun disc + halo (hidden below the horizon or at night)
    vec3 sd = sun_dir.xyz;
    vec3 sun_emission = vec3( 0.0 );
    if( sd.z > -0.05 && daylight > 0.01 ) {
        float d = dot( ray, normalize( sd ) );
        float disc = smoothstep( 0.9994, 0.9998, d );
        float halo = pow( max( d, 0.0 ), 64.0 ) * 0.25;
        sun_emission = ( vec3( 4.0, 3.8, 3.2 ) * disc + vec3( 1.0, 0.9, 0.7 ) * halo )
                       * daylight * ( 1.0 - params.z * 0.6 );
        col += sun_emission;
    }

    // clouds: intersect the ray with the same world-locked plane used for
    // ground cloud shadows, so weather and wind share one noise field
    if( ray.z > 0.02 ) {
        float cloud_t = ( cloud_mapping.z - eye_pos.z ) / ray.z;
        vec2 cloud_xy = eye_pos.xy + ray.xy * cloud_t;
        vec2 cpos = atmosphere_cloud_coordinates( cloud_xy, cloud_mapping.xy, wind.xy,
                    cloud_mapping.w );
        float cov = atmosphere_cloud_coverage( cpos, params.z );
        cov *= smoothstep( 0.02, 0.12, ray.z ); // fade out near the horizon
        vec3 cloud_col = mix( vec3( 0.03, 0.03, 0.05 ),
                              vec3( 0.95, 0.96, 1.0 ), daylight );
        // a second noise sample shades the cloud body so it reads as puffy,
        // not a flat sticker
        cloud_col *= 0.6 + 0.5 * atmosphere_fbm( cpos * 1.7 + 3.1 );
        float cloud_mix = min( cov * 1.15, 0.95 );
        col = mix( col, cloud_col, cloud_mix );
        sun_emission *= 1.0 - cloud_mix;
    }

    // night vision goggles: the whole viewport turns green like 2D's map.
    // daylight takes the overexposed look, the same hand-over the map uses
    // (smooth_lighting::overexpose_start)
    if( params.w > 0.5 ) {
        col = mix( nightvision_rgb( col ), overexposed_rgb( col ),
                   smoothstep( 0.85, 1.0, daylight ) );
        sun_emission = vec3( 0.0 );
    }
    out_color = vec4( col, 1.0 );
    out_emissive = vec4( sun_emission, 1.0 );
}
