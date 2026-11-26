#ifndef WEATHER3D_GLSL
#define WEATHER3D_GLSL

layout(set = 2, binding = 2) uniform sampler2D weather_depth_tex;
layout(set = 2, binding = 3) uniform sampler2D weather_mask_tex;

layout(set = 3, binding = 0) uniform WeatherPostUBO {
    vec4 cam_right;
    vec4 cam_up;
    vec4 cam_forward;
    vec4 eye_pos;       // xyz = camera position, w = player position is exposed
    vec4 ray_params;    // x = tan(fov/2), y = aspect, z = near, w = far
    vec4 precipitation; // x = rain, y = snow, z = seconds, w = enabled
    vec4 wind;          // xy = world direction, z = normalized speed, w = daylight
    vec4 mask_mapping;  // xy = map origin, z = level height
};

float weather_hash( vec2 p )
{
    vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
    p3 += dot( p3, p3.yzx + 33.33 );
    return fract( ( p3.x + p3.y ) * p3.z );
}

float weather_linear_depth( float depth )
{
    float zn = ray_params.z;
    float zf = ray_params.w;
    return zn * zf / max( zf - depth * ( zf - zn ), 1.0e-5 );
}

vec3 weather_world_position( vec2 uv, float depth )
{
    vec2 ndc = vec2( uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0 );
    vec3 ray = cam_forward.xyz + cam_right.xyz * ( ndc.x * ray_params.x * ray_params.y ) +
               cam_up.xyz * ( ndc.y * ray_params.x );
    return eye_pos.xyz + ray * weather_linear_depth( depth );
}

float weather_exposure( vec2 uv )
{
    float depth = texture( weather_depth_tex, uv ).r;
    if( depth >= 0.999999 ) {
        return eye_pos.w;
    }
    vec3 position = weather_world_position( uv, depth );
    vec2 map_xy = position.xy + mask_mapping.xy;
    ivec2 cell = ivec2( floor( map_xy ) );
    int layer = int( floor( position.z / mask_mapping.z + 1.5 ) );
    int rows = textureSize( weather_mask_tex, 0 ).y / 3;
    if( cell.x < 0 || cell.x >= textureSize( weather_mask_tex, 0 ).x ||
        cell.y < 0 || cell.y >= rows || layer < 0 || layer >= 3 ) {
        return 0.0;
    }
    return texelFetch( weather_mask_tex, ivec2( cell.x, layer * rows + cell.y ), 0 ).r;
}

vec2 weather_screen_wind()
{
    vec3 world_wind = vec3( wind.xy, 0.0 );
    return vec2( dot( world_wind, cam_right.xyz ), dot( world_wind, cam_up.xyz ) );
}

float weather_rain_layer( vec2 uv, vec2 direction, float cells, float speed, float threshold )
{
    vec2 across = vec2( direction.y, -direction.x );
    vec2 p = vec2( dot( uv, across ) * cells,
                   dot( uv, direction ) * cells * 0.12 + precipitation.z * speed );
    vec2 id = floor( p );
    vec2 f = fract( p );
    float random = weather_hash( id );
    float center = 0.15 + 0.70 * weather_hash( id + 17.3 );
    float width = mix( 0.018, 0.042, weather_hash( id + 41.7 ) );
    float line = 1.0 - smoothstep( width, width * 2.2, abs( f.x - center ) );
    float ends = smoothstep( 0.0, 0.16, f.y ) * ( 1.0 - smoothstep( 0.68, 1.0, f.y ) );
    return line * ends * step( threshold, random );
}

float weather_snow_layer( vec2 uv, vec2 drift, float cells, float speed, float threshold )
{
    vec2 p = uv * cells + drift + vec2( 0.0, precipitation.z * speed );
    vec2 id = floor( p );
    vec2 f = fract( p );
    float random = weather_hash( id );
    vec2 center = vec2( 0.20 + 0.60 * weather_hash( id + 11.1 ),
                        0.20 + 0.60 * weather_hash( id + 29.7 ) );
    center.x += sin( precipitation.z * 1.7 + random * 6.2831853 ) * 0.10;
    float radius = mix( 0.07, 0.16, weather_hash( id + 53.9 ) );
    float flake = 1.0 - smoothstep( radius * 0.35, radius, length( f - center ) );
    return flake * step( threshold, random );
}

vec3 weather3d_apply( vec3 rgb, vec2 uv )
{
    if( precipitation.w < 0.5 ) {
        return rgb;
    }
    float exposure = weather_exposure( uv );
    if( exposure <= 0.0 ) {
        return rgb;
    }

    vec2 aspect_uv = vec2( uv.x * ray_params.y, uv.y );
    vec2 screen_wind = weather_screen_wind();
    float daylight = clamp( wind.w, 0.0, 1.0 );

    if( precipitation.x > 0.001 ) {
        vec2 direction = normalize( vec2( screen_wind.x * ( 0.20 + wind.z * 0.50 ),
                                         max( 0.65, 1.0 - screen_wind.y * 0.20 ) ) );
        float threshold = 0.84 - precipitation.x * 0.22;
        float streaks = weather_rain_layer( aspect_uv, direction, 72.0, 1.5, threshold ) * 0.65;
        streaks += weather_rain_layer( aspect_uv + 7.1, direction, 108.0, 2.1, threshold ) * 0.85;
        streaks += weather_rain_layer( aspect_uv + 19.7, direction, 154.0, 2.8, threshold );
        float opacity = min( streaks * precipitation.x * 0.24 * exposure, 0.34 );
        vec3 rain_color = mix( vec3( 0.08, 0.10, 0.14 ), vec3( 0.55, 0.66, 0.78 ), daylight );
        rgb = mix( rgb, rain_color, opacity );
    }

    if( precipitation.y > 0.001 ) {
        vec2 drift = vec2( -screen_wind.x, screen_wind.y ) * precipitation.z *
                     ( 0.12 + wind.z * 0.32 );
        float threshold = 0.88 - precipitation.y * 0.28;
        float flakes = weather_snow_layer( aspect_uv, drift, 24.0, 0.16, threshold ) * 0.65;
        flakes += weather_snow_layer( aspect_uv + 13.9, drift * 1.25, 36.0, 0.24, threshold ) * 0.85;
        flakes += weather_snow_layer( aspect_uv + 37.3, drift * 1.55, 52.0, 0.34, threshold );
        float opacity = min( flakes * precipitation.y * 0.48 * exposure, 0.58 );
        vec3 snow_color = mix( vec3( 0.20, 0.23, 0.29 ), vec3( 0.85, 0.90, 1.0 ), daylight );
        rgb = mix( rgb, snow_color, opacity );
    }
    return rgb;
}

#endif
