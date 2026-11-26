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
    return atmosphere_noise( p ) * 0.50 + atmosphere_noise( p * 2.03 ) * 0.27 +
           atmosphere_noise( p * 4.09 ) * 0.15 + atmosphere_noise( p * 8.17 ) * 0.08;
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

float atmosphere_low_cloud_coverage( vec2 coordinates, float cloudiness, float storminess )
{
    vec2 warp = vec2( atmosphere_fbm( coordinates * 0.47 + vec2( 5.2, 1.3 ) ),
                      atmosphere_fbm( coordinates * 0.47 + vec2( -3.7, 8.1 ) ) ) - 0.5;
    float n = atmosphere_fbm( coordinates + warp * ( 0.32 + 0.28 * storminess ) );
    float threshold = mix( 0.78, 0.18, cloudiness );
    float edge = mix( 0.09, 0.18, storminess );
    float coverage = smoothstep( threshold - edge, threshold + edge, n );
    float opacity = smoothstep( 0.0, 0.18, cloudiness ) * mix( 0.88, 1.0, storminess );
    return coverage * opacity;
}

vec2 atmosphere_high_cloud_coordinates( vec2 world_xy, vec2 map_origin, vec2 wind, float scale )
{
    vec2 high_wind = wind * 0.38 + vec2( -wind.y, wind.x ) * 0.22;
    return atmosphere_cloud_coordinates( world_xy, map_origin, high_wind, scale * 0.52 ) +
           vec2( 17.3, -11.8 );
}

float atmosphere_high_cloud_coverage( vec2 coordinates, float cloudiness, float storminess )
{
    float n = atmosphere_fbm( coordinates );
    float threshold = mix( 0.74, 0.30, cloudiness );
    float coverage = smoothstep( threshold - 0.06, threshold + 0.12, n );
    float opacity = smoothstep( 0.08, 0.60, cloudiness ) * mix( 0.28, 0.40, storminess );
    return coverage * opacity;
}

#endif
