#ifndef ATMOSPHERE3D_GLSL
#define ATMOSPHERE3D_GLSL

float atmosphere_hash2( vec2 p )
{
    return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}

float atmosphere_noise( vec2 p )
{
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( atmosphere_hash2( i ), atmosphere_hash2( i + vec2( 1.0, 0.0 ) ), u.x ),
                mix( atmosphere_hash2( i + vec2( 0.0, 1.0 ) ),
                     atmosphere_hash2( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}

float atmosphere_fbm( vec2 p )
{
    return atmosphere_noise( p ) * 0.5 + atmosphere_noise( p * 2.03 ) * 0.3 +
           atmosphere_noise( p * 4.09 ) * 0.2;
}

vec3 atmosphere_horizon_color( float daylight )
{
    return mix( vec3( 0.008, 0.009, 0.018 ), vec3( 0.55, 0.66, 0.82 ),
                clamp( daylight, 0.0, 1.0 ) );
}

vec2 atmosphere_cloud_coordinates( vec2 world_xy, vec2 map_origin, vec2 wind, float scale )
{
    return ( world_xy + map_origin ) * scale + wind;
}

float atmosphere_cloud_coverage( vec2 coordinates, float cloudiness )
{
    float n = atmosphere_fbm( coordinates );
    float threshold = 1.02 - cloudiness * 0.8;
    return smoothstep( threshold - 0.10, threshold + 0.18, n );
}

#endif
