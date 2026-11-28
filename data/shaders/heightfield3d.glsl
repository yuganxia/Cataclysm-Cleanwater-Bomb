#ifndef HEIGHTFIELD3D_GLSL
#define HEIGHTFIELD3D_GLSL

// The caller declares height_tex and height_mapping. World XY and the mapping
// origin are view-center-relative; texels store display-unit height offsets.
float terrain_height_at( vec2 world_xy )
{
    vec2 p = world_xy - height_mapping.xy;
    ivec2 size = textureSize( height_tex, 0 );
    vec2 clamped = clamp( p, vec2( 0.0 ), vec2( size - 1 ) );
    ivec2 base = ivec2( floor( clamped ) );
    ivec2 next = min( base + ivec2( 1 ), size - 1 );
    vec2 f = clamped - floor( clamped );
    float top = mix( texelFetch( height_tex, base, 0 ).r,
                     texelFetch( height_tex, ivec2( next.x, base.y ), 0 ).r, f.x );
    float bottom = mix( texelFetch( height_tex, ivec2( base.x, next.y ), 0 ).r,
                        texelFetch( height_tex, next, 0 ).r, f.x );
    return mix( top, bottom, f.y );
}

vec3 terrain_height_normal( vec2 world_xy )
{
    float dx = ( terrain_height_at( world_xy + vec2( 1.0, 0.0 ) ) -
                 terrain_height_at( world_xy - vec2( 1.0, 0.0 ) ) ) * 0.5;
    float dy = ( terrain_height_at( world_xy + vec2( 0.0, 1.0 ) ) -
                 terrain_height_at( world_xy - vec2( 0.0, 1.0 ) ) ) * 0.5;
    return normalize( vec3( -dx, -dy, 1.0 ) );
}

#endif
