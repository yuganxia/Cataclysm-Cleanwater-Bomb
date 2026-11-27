#ifndef SKY3D_GLSL
#define SKY3D_GLSL

#include "atmosphere3d.glsl"

vec3 sky3d_radiance( vec3 ray, vec3 eye_position, vec3 sun_direction, float daylight,
                     float cloudiness, float storminess, float fog_strength, vec2 wind_offset,
                     vec2 map_origin, float cloud_height, float cloud_scale, out vec3 sun_emission )
{
    vec3 zenith = mix( vec3( 0.004, 0.009, 0.025 ), vec3( 0.18, 0.34, 0.64 ), daylight );
    vec3 horizon = atmosphere_horizon_color( daylight );
    float golden_hour = ( 1.0 - smoothstep( 0.42, 0.72, sun_direction.z ) ) * daylight;
    horizon = mix( horizon, vec3( 0.95, 0.42, 0.17 ) * daylight, golden_hour * 0.62 );
    vec3 col;
    if( ray.z >= 0.0 ) {
        col = mix( horizon, zenith, pow( ray.z, 0.6 ) );
    } else {
        vec3 voidc = vec3( 0.010, 0.010, 0.014 ) * ( 0.3 + 0.7 * daylight );
        col = mix( horizon, voidc, clamp( -ray.z * 6.0, 0.0, 1.0 ) );
    }

    sun_emission = vec3( 0.0 );
    if( daylight > 0.01 ) {
        float d = dot( ray, normalize( sun_direction ) );
        float disc = smoothstep( 0.99935, 0.99975, d );
        float halo = pow( max( d, 0.0 ), 32.0 ) * 0.48;
        float forward_scatter = pow( max( d, 0.0 ), 10.0 ) * 0.10;
        sun_emission = ( vec3( 7.0, 5.7, 3.8 ) * disc +
                         vec3( 1.35, 1.05, 0.72 ) * halo ) * daylight;
        col += sun_emission + vec3( 0.20, 0.13, 0.065 ) * forward_scatter * daylight;
    } else {
        float d = dot( ray, normalize( sun_direction ) );
        float moon = smoothstep( 0.99955, 0.99982, d );
        float halo = pow( max( d, 0.0 ), 48.0 ) * 0.08;
        sun_emission = vec3( 0.85, 0.98, 1.30 ) * ( moon * 0.85 + halo );
        col += sun_emission;
    }

    if( ray.z > 0.02 ) {
        float horizon_fade = smoothstep( 0.02, 0.12, ray.z );
        float high_height = cloud_height * 1.85;
        if( high_height > eye_position.z ) {
            float cloud_t = ( high_height - eye_position.z ) / ray.z;
            vec2 cloud_xy = eye_position.xy + ray.xy * cloud_t;
            vec2 cpos = atmosphere_high_cloud_coordinates(
                            cloud_xy, map_origin, wind_offset, cloud_scale );
            float cov = atmosphere_high_cloud_coverage( cpos, cloudiness, storminess ) * horizon_fade;
            vec3 day_color = mix( vec3( 0.78, 0.82, 0.90 ),
                                  vec3( 0.48, 0.51, 0.58 ), storminess );
            vec3 cloud_col = mix( vec3( 0.020, 0.023, 0.038 ), day_color, daylight );
            cloud_col *= 0.86 + 0.22 * atmosphere_noise( cpos * 1.9 + 3.1 );
            col = mix( col, cloud_col, cov );
            sun_emission *= 1.0 - cov;
        }

        if( cloud_height > eye_position.z ) {
            float cloud_t = ( cloud_height - eye_position.z ) / ray.z;
            vec2 cloud_xy = eye_position.xy + ray.xy * cloud_t;
            vec2 cpos = atmosphere_cloud_coordinates(
                            cloud_xy, map_origin, wind_offset, cloud_scale );
            float cov = atmosphere_low_cloud_coverage( cpos, cloudiness, storminess ) * horizon_fade;
            float detail = atmosphere_noise( cpos * 2.2 + vec2( 3.1, -1.7 ) );
            vec3 day_color = mix( vec3( 0.90, 0.93, 1.0 ),
                                  vec3( 0.23, 0.26, 0.32 ), storminess );
            vec3 cloud_col = mix( vec3( 0.025, 0.027, 0.043 ), day_color, daylight );
            float thickness = cov * ( 0.65 + 0.35 * storminess );
            cloud_col *= ( 0.88 + 0.20 * detail ) * mix( 1.06, 0.58, thickness );
            float edge = smoothstep( 0.03, 0.32, cov ) * ( 1.0 - smoothstep( 0.42, 0.90, cov ) );
            float toward_sun = pow( max( dot( ray, normalize( sun_direction ) ), 0.0 ), 10.0 ) * daylight;
            cloud_col += vec3( 0.28, 0.24, 0.17 ) * edge * toward_sun * ( 1.0 - storminess * 0.65 );
            col = mix( col, cloud_col, cov );
            sun_emission *= 1.0 - cov;
        }
    }
    if( fog_strength > 0.0 ) {
        float horizon_haze = pow( 1.0 - clamp( abs( ray.z ), 0.0, 1.0 ), 3.0 );
        float fog = min( horizon_haze * fog_strength, 0.88 );
        col = mix( col, atmosphere_fog_color( daylight, cloudiness ), fog );
        sun_emission *= 1.0 - fog;
    }
    return col;
}

#endif
