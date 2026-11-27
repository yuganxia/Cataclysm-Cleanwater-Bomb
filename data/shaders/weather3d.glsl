#ifndef WEATHER3D_GLSL
#define WEATHER3D_GLSL

// The caller declares weather_mask_tex and mask_mapping before including this
// helper. Position is in the same center-relative scene frame as the terrain.
float weather_roof_exposure( vec3 position )
{
    vec2 map_xy = position.xy + mask_mapping.xy;
    ivec2 cell = ivec2( floor( map_xy ) );
    int layers = max( 1, int( mask_mapping.w + 0.5 ) );
    int layer = int( floor( position.z / mask_mapping.z + 0.5 ) ) + layers / 2;
    int rows = textureSize( weather_mask_tex, 0 ).y / layers;
    if( cell.x < 0 || cell.x >= textureSize( weather_mask_tex, 0 ).x ||
        cell.y < 0 || cell.y >= rows || layer < 0 || layer >= layers ) {
        return 0.0;
    }
    return texelFetch( weather_mask_tex, ivec2( cell.x, layer * rows + cell.y ), 0 ).r;
}

#endif
