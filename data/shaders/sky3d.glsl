#ifndef SKY3D_GLSL
#define SKY3D_GLSL

#include "atmosphere3d.glsl"

vec3 sky3d_radiance( vec3 ray, vec3 eye_position, vec3 sun_direction, float daylight,
                     float cloudiness, vec2 wind_offset, vec2 map_origin,
                     float cloud_height, float cloud_scale, out vec3 sun_emission )
{
    vec3 zenith = mix( vec3( 0.004, 0.005, 0.012 ), vec3( 0.22, 0.42, 0.75 ), daylight );
    vec3 horizon = atmosphere_horizon_color( daylight );
    vec3 col;
    if( ray.z >= 0.0 ) {
        col = mix( horizon, zenith, pow( ray.z, 0.6 ) );
    } else {
        vec3 voidc = vec3( 0.010, 0.010, 0.014 ) * ( 0.3 + 0.7 * daylight );
        col = mix( horizon, voidc, clamp( -ray.z * 6.0, 0.0, 1.0 ) );
    }

    sun_emission = vec3( 0.0 );
    if( sun_direction.z > -0.05 && daylight > 0.01 ) {
        float d = dot( ray, normalize( sun_direction ) );
        float disc = smoothstep( 0.9994, 0.9998, d );
        float halo = pow( max( d, 0.0 ), 64.0 ) * 0.25;
        sun_emission = ( vec3( 4.0, 3.8, 3.2 ) * disc + vec3( 1.0, 0.9, 0.7 ) * halo )
                       * daylight * ( 1.0 - cloudiness * 0.6 );
        col += sun_emission;
    }

    if( ray.z > 0.02 ) {
        float cloud_t = ( cloud_height - eye_position.z ) / ray.z;
        vec2 cloud_xy = eye_position.xy + ray.xy * cloud_t;
        vec2 cpos = atmosphere_cloud_coordinates( cloud_xy, map_origin, wind_offset, cloud_scale );
        float cov = atmosphere_cloud_coverage( cpos, cloudiness );
        cov *= smoothstep( 0.02, 0.12, ray.z );
        vec3 cloud_col = mix( vec3( 0.03, 0.03, 0.05 ),
                              vec3( 0.95, 0.96, 1.0 ), daylight );
        cloud_col *= 0.6 + 0.5 * atmosphere_fbm( cpos * 1.7 + 3.1 );
        float cloud_mix = min( cov * 1.15, 0.95 );
        col = mix( col, cloud_col, cloud_mix );
        sun_emission *= 1.0 - cloud_mix;
    }
    return col;
}

#endif
