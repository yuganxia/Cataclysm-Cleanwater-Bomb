#ifndef WATER_WAVES3D_GLSL
#define WATER_WAVES3D_GLSL

#include "atmosphere3d.glsl"

vec2 water_flow_direction( vec2 flow )
{
    return dot( flow, flow ) > 1.0e-6 ? normalize( flow ) : normalize( vec2( 0.82, 0.57 ) );
}

float water_wave_height( vec2 position, vec2 flow, float time, float amplitude, float wind )
{
    vec2 direction0 = water_flow_direction( flow );
    vec2 direction1 = normalize( vec2( -direction0.y, direction0.x ) + direction0 * 0.35 );
    vec2 direction2 = normalize( direction0 * 0.62 - vec2( -direction0.y, direction0.x ) );
    float speed = 0.75 + wind * 0.80;
    float height = sin( dot( direction0, position ) * 1.45 - time * speed ) * 0.52;
    height += sin( dot( direction1, position ) * 2.75 + time * speed * 1.37 ) * 0.28;
    height += sin( dot( direction2, position ) * 5.40 - time * speed * 1.91 ) * 0.14;
    height += ( atmosphere_noise( position * 1.35 + direction0 * time * 0.12 ) - 0.5 ) * 0.18;
    return height * amplitude;
}

vec2 water_rain_gradient( vec2 position, float time, float strength )
{
    if( strength < 0.001 ) {
        return vec2( 0.0 );
    }
    vec2 cell_position = position * 1.65;
    vec2 cell = floor( cell_position );
    vec2 local = fract( cell_position ) - 0.5;
    float random = atmosphere_hash2( cell );
    float phase = fract( time * 1.35 + random );
    float radius = length( local );
    float envelope = exp( -radius * 5.5 ) * ( 1.0 - phase );
    float wave = sin( radius * 42.0 - phase * 6.2831853 ) * envelope;
    return local / max( radius, 0.025 ) * wave * strength * 0.065;
}

vec3 water_wave_normal( vec2 position, vec2 flow, float time, float slope, float wind,
                        float rain )
{
    vec2 direction0 = water_flow_direction( flow );
    vec2 direction1 = normalize( vec2( -direction0.y, direction0.x ) + direction0 * 0.35 );
    vec2 direction2 = normalize( direction0 * 0.62 - vec2( -direction0.y, direction0.x ) );
    float speed = 0.75 + wind * 0.80;
    float phase0 = dot( direction0, position ) * 1.45 - time * speed;
    float phase1 = dot( direction1, position ) * 2.75 + time * speed * 1.37;
    float phase2 = dot( direction2, position ) * 5.40 - time * speed * 1.91;
    vec2 gradient = direction0 * ( cos( phase0 ) * 0.52 * 1.45 ) +
                    direction1 * ( cos( phase1 ) * 0.28 * 2.75 ) +
                    direction2 * ( cos( phase2 ) * 0.14 * 5.40 );
    vec2 drift = direction0 * time * 0.12;
    float epsilon = 0.12;
    float noise = atmosphere_noise( position * 1.35 + drift );
    float noise_x = atmosphere_noise( ( position + vec2( epsilon, 0.0 ) ) * 1.35 + drift );
    float noise_y = atmosphere_noise( ( position + vec2( 0.0, epsilon ) ) * 1.35 + drift );
    gradient += vec2( noise_x - noise, noise_y - noise ) / epsilon * 0.35;
    gradient = gradient * slope + water_rain_gradient( position, time, rain );
    return normalize( vec3( -gradient, 1.0 ) );
}

#endif
