// Experimental 3D terrain renderer: tileset atlas sampling with alpha cutout,
// plus a screen-door occlusion mask hiding geometry between camera and player.
// SDL GPU fragment samplers live in set 2, fragment uniform buffers in set 3.

#version 450
#extension GL_GOOGLE_include_directive : require

#include "atmosphere3d.glsl"
#include "color3d.glsl"
#include "memory_presets.glsl"
#include "nightvision_presets.glsl"

layout(set = 2, binding = 0) uniform sampler2D atlas_tex;
layout(set = 2, binding = 1) uniform sampler2D shadow_tex;
layout(set = 2, binding = 2) uniform sampler2D light_tex;
layout(set = 2, binding = 3) uniform sampler2D ao_tex;
layout(set = 2, binding = 4) uniform sampler2D weather_mask_tex;
layout(set = 2, binding = 5) uniform sampler2D grid_material_tex;

layout(set = 3, binding = 0) uniform FragUBO {
    vec4 eye_pos;      // xyz = camera position (scene coords)
    vec4 player_pos;   // xyz = player position (scene coords)
    vec4 cam_right;    // xyz = camera right basis (screen-horizontal)
    vec4 cam_up;       // xyz = camera up basis (screen-vertical)
    vec4 mask_params;  // x = inner radius along cam_right, y = inner radius along
                       // cam_up, z = player's ground plane z, w = mask enabled
    vec4 memory_params; // x = named memory preset 0..3, y = 1 for the custom mixer
    vec4 memory_dark;   // rgb = custom dark color, w = gamma
    vec4 memory_light;  // rgb = custom light color
    vec4 nv_params;     // x = 1 in a night vision frame (instance_color.a then carries
                        // the tile light), y = night floor, z = overexpose start
    vec4 cursor_params; // xy = cursor in top-left screen UV, z = mask enabled
    vec4 effect_params; // xy = cursor ellipse radii, z = inverse full wall height, w = depth only
    mat4 light_vp;
    vec4 shadow_params; // x = enabled, y = texel size, z = depth bias
    vec4 shadow_pcss;   // x = ortho width, y = depth range, z = sun size, w = max radius in texels
    vec4 light_params;  // x = enabled, y = rows per z, z = center layer, w = level height
    vec4 light_origin;  // xy = view center in map coordinates
    vec4 atmosphere_sun; // xyz = direction toward sun, w = daylight
    vec4 atmosphere_wind; // xy = cloud drift, z = cloudiness, w = fog strength
    vec4 atmosphere_params; // x = cloud height, y = cloud scale, z = fog start, w = fog end
    vec4 atmosphere_origin; // xy = view center in map coordinates, z = storminess
    vec4 ao_params;     // x = enabled, y = strength, z = fade start, w = fade end
    vec4 sunlight_color; // rgb = direct key tint, w = direct-light gain
    vec4 ambient_color;  // rgb = sky hemisphere tint, w = ambient-light gain
    vec4 ground_color;   // rgb = ground hemisphere tint
    vec4 lighting_params; // x = night amount, y = local-light response,
                          // z/w = shadow fade start/end in world units
    vec4 mask_mapping; // xy = map origin, z = level height, w = roof-mask layers
    vec4 bounce_params; // x = enabled, y = indoor penumbra multiplier, z = portal gain
    vec4 grid_mapping; // xy = tile-grid origin, z = tile count per row, w = enabled
};

#include "weather3d.glsl"

layout(location = 0) in vec4 v_color;
layout(location = 1) in vec2 v_uv;
layout(location = 2) in float v_flags;
layout(location = 3) in vec3 v_normal;
layout(location = 4) in vec3 v_world;
layout(location = 5) in vec2 v_screen;
layout(location = 6) in float v_wrap;
layout(location = 7) in vec3 v_tile;
layout(location = 8) in vec4 v_emission;
layout(location = 9) in float v_grid;

layout(location = 0) out vec4 out_color;
layout(location = 1) out vec4 out_emissive;

const vec2 shadow_poisson[16] = vec2[](
    vec2( -0.94201624, -0.39906216 ), vec2( 0.94558609, -0.76890725 ),
    vec2( -0.09418410, -0.92938870 ), vec2( 0.34495938, 0.29387760 ),
    vec2( -0.91588581, 0.45771432 ), vec2( -0.81544232, -0.87912464 ),
    vec2( -0.38277543, 0.27676845 ), vec2( 0.97484398, 0.75648379 ),
    vec2( 0.44323325, -0.97511554 ), vec2( 0.53742981, -0.47373420 ),
    vec2( -0.26496911, -0.41893023 ), vec2( 0.79197514, 0.19090188 ),
    vec2( -0.24188840, 0.99706507 ), vec2( -0.81409955, 0.91437590 ),
    vec2( 0.19984126, 0.78641367 ), vec2( 0.14383161, -0.14100790 )
);

float sun_visibility( vec3 normal, vec3 light_dir )
{
    float ndotl = max( dot( normal, light_dir ), 0.0 );
    if( shadow_params.x < 0.5 || ndotl <= 0.001 ) {
        return 1.0;
    }
    // Move the receiver along its own normal before projecting.  Depth bias
    // alone cannot remove acne on steep walls without also creating peter-panning.
    float normal_offset = 0.018 + 0.045 * ( 1.0 - ndotl );
    vec4 light_pos = light_vp * vec4( v_world + normal * normal_offset, 1.0 );
    vec3 ndc = light_pos.xyz / light_pos.w;
    vec2 uv = vec2( ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5 );
    if( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ||
        ndc.z < 0.0 || ndc.z > 1.0 ) {
        return 1.0;
    }
    float bias = shadow_params.z * ( 1.0 + 3.0 * ( 1.0 - ndotl ) );
    float angle = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) *
                         43758.5453 ) * 6.28318530718;
    float cs = cos( angle );
    float sn = sin( angle );
    mat2 rotation = mat2( cs, sn, -sn, cs );
    float search_radius = shadow_params.y * shadow_pcss.w;
    float blocker_depth_sum = 0.0;
    int blocker_count = 0;
    for( int i = 0; i < 16; ++i ) {
        vec2 sample_uv = uv + rotation * shadow_poisson[i] * search_radius;
        if( sample_uv.x < 0.0 || sample_uv.x > 1.0 ||
            sample_uv.y < 0.0 || sample_uv.y > 1.0 ) {
            continue;
        }
        float depth = texture( shadow_tex, sample_uv ).r;
        if( depth < ndc.z - bias ) {
            blocker_depth_sum += depth;
            ++blocker_count;
        }
    }
    if( blocker_count == 0 ) {
        return 1.0;
    }

    float blocker_depth = blocker_depth_sum / float( blocker_count );
    float world_gap = max( ( ndc.z - blocker_depth ) * shadow_pcss.y, 0.0 );
    float penumbra_scale = 1.0;
    if( bounce_params.x > 0.5 ) {
        float indoor = 1.0 - weather_roof_exposure( vec3( v_world.xy, v_tile.z ) );
        penumbra_scale = mix( 1.0, bounce_params.y, indoor );
    }
    float penumbra_world = world_gap * shadow_pcss.z * penumbra_scale;
    float radius = clamp( penumbra_world / shadow_pcss.x,
                          shadow_params.y, search_radius );
    float filter_bias = bias * ( 1.0 + 0.25 * radius / shadow_params.y );
    float visible = 0.0;
    for( int i = 0; i < 16; ++i ) {
        vec2 sample_uv = uv + rotation * shadow_poisson[i] * radius;
        float depth = texture( shadow_tex, sample_uv ).r;
        visible += ndc.z - filter_bias <= depth ? 1.0 : 0.0;
    }
    visible /= 16.0;
    float distance_fade = 1.0 - smoothstep( lighting_params.z, lighting_params.w,
                                            length( v_world - eye_pos.xyz ) );
    return mix( 1.0, visible, distance_fade );
}

struct scene_light_sample {
    float intensity;
    vec3 hue;
};

scene_light_sample sample_scene_light()
{
    if( light_params.x < 0.5 ) {
        return scene_light_sample( 1.0, vec3( 1.0 ) );
    }
    int rows = int( light_params.y + 0.5 );
    int relative_z = int( floor( ( v_tile.z + 0.5 * light_params.w ) / light_params.w ) );
    int layer = int( light_params.z + 0.5 ) + relative_z;
    vec2 map_xy = v_world.xy + light_origin.xy;
    ivec2 own = ivec2( floor( map_xy ) );
    int map_width = textureSize( light_tex, 0 ).x;
    if( own.x < 0 || own.x >= map_width || own.y < 0 || own.y >= rows ||
        layer < 0 || layer * rows >= textureSize( light_tex, 0 ).y ) {
        return scene_light_sample( 1.0, vec3( 1.0 ) );
    }
    vec4 own_texel = texelFetch( light_tex, ivec2( own.x, layer * rows + own.y ), 0 );
    int own_flags = int( own_texel.a * 255.0 + 0.5 );
    bool own_barrier = ( own_flags & 2 ) != 0;
    vec2 st = map_xy - 0.5;
    ivec2 base = ivec2( floor( st ) );
    vec2 f = fract( st );
    vec3 chroma = vec3( 0.0 );
    float intensity = 0.0;
    float weight_sum = 0.0;
    for( int y = 0; y <= 1; ++y ) {
        for( int x = 0; x <= 1; ++x ) {
            ivec2 cell = base + ivec2( x, y );
            if( cell.x < 0 || cell.x >= map_width || cell.y < 0 || cell.y >= rows ) {
                continue;
            }
            vec4 t = texelFetch( light_tex, ivec2( cell.x, layer * rows + cell.y ), 0 );
            bool barrier = ( int( t.a * 255.0 + 0.5 ) & 2 ) != 0;
            if( barrier != own_barrier ) {
                continue;
            }
            float weight = ( x == 0 ? 1.0 - f.x : f.x ) *
                           ( y == 0 ? 1.0 - f.y : f.y );
            vec3 tap_chroma = vec3( t.g, t.b, max( 1.0 - t.g - t.b, 0.0 ) );
            chroma += weight * tap_chroma;
            intensity += weight * t.r;
            weight_sum += weight;
        }
    }
    if( weight_sum < 1.0e-4 ) {
        return scene_light_sample( own_texel.r, vec3( 1.0 ) );
    }
    chroma /= weight_sum;
    intensity /= weight_sum;
    vec3 hue = chroma / max( max( chroma.r, chroma.g ), max( chroma.b, 1.0e-4 ) );
    return scene_light_sample( intensity, hue );
}

float cloud_sun_visibility()
{
    if( atmosphere_sun.z <= 0.05 || atmosphere_sun.w <= 0.05 ) {
        return 1.0;
    }
    float low_coverage = 0.0;
    if( atmosphere_params.x > v_world.z ) {
        float cloud_t = ( atmosphere_params.x - v_world.z ) / atmosphere_sun.z;
        vec2 cloud_xy = v_world.xy + atmosphere_sun.xy * cloud_t;
        vec2 coordinates = atmosphere_cloud_coordinates(
                               cloud_xy, atmosphere_origin.xy,
                               atmosphere_wind.xy, atmosphere_params.y );
        low_coverage = atmosphere_low_cloud_coverage(
                           coordinates, atmosphere_wind.z, atmosphere_origin.z );
    }
    float high_coverage = 0.0;
    float high_height = atmosphere_params.x * 1.85;
    if( high_height > v_world.z ) {
        float cloud_t = ( high_height - v_world.z ) / atmosphere_sun.z;
        vec2 cloud_xy = v_world.xy + atmosphere_sun.xy * cloud_t;
        vec2 coordinates = atmosphere_high_cloud_coordinates(
                               cloud_xy, atmosphere_origin.xy,
                               atmosphere_wind.xy, atmosphere_params.y );
        high_coverage = atmosphere_high_cloud_coverage(
                            coordinates, atmosphere_wind.z, atmosphere_origin.z );
    }
    float occlusion = low_coverage * ( 0.55 + 0.20 * atmosphere_origin.z ) +
                      high_coverage * 0.22;
    return 1.0 - min( occlusion, 0.85 );
}

float ambient_occlusion()
{
    if( ao_params.x < 0.5 ) {
        return 1.0;
    }
    float ao = texture( ao_tex, v_screen ).r;
    float distance_to_eye = length( v_world - eye_pos.xyz );
    float fade = 1.0 - smoothstep( ao_params.z, ao_params.w, distance_to_eye );
    return mix( 1.0, ao, ao_params.y * fade );
}

vec3 apply_air_perspective( vec3 rgb )
{
    if( atmosphere_wind.w <= 0.0 ) {
        return rgb;
    }
    float distance_to_eye = length( v_world - eye_pos.xyz );
    float fog = smoothstep( atmosphere_params.z, atmosphere_params.w, distance_to_eye );
    fog *= atmosphere_wind.w * exp( -max( v_world.z, 0.0 ) * 0.01 );
    vec3 fog_color = atmosphere_fog_color( atmosphere_sun.w, atmosphere_wind.z );
    return mix( rgb, fog_color, clamp( fog, 0.0, 0.88 ) );
}

void main()
{
    out_emissive = vec4( 0.0 );
    vec4 instance_color = v_color;
    vec2 instance_uv = v_uv;
    vec4 instance_emission = v_emission;
    int flags = int( v_flags + 0.5 );
    if( v_grid > 0.5 ) {
        ivec2 tile = ivec2( floor( v_world.xy - grid_mapping.xy ) );
        ivec2 texture_size = textureSize( grid_material_tex, 0 );
        tile = clamp( tile, ivec2( 0 ), ivec2( texture_size.x / 3, texture_size.y ) - 1 );
        int material_x = tile.x * 3;
        vec4 uv_rect = texelFetch( grid_material_tex, ivec2( material_x, tile.y ), 0 );
        instance_color = texelFetch( grid_material_tex, ivec2( material_x + 1, tile.y ), 0 );
        vec4 packed = texelFetch( grid_material_tex, ivec2( material_x + 2, tile.y ), 0 );
        flags = int( packed.x + 0.5 );
        instance_emission = vec4( packed.yzw, 1.0 );
        vec2 q = v_uv;
        int rota = ( flags >> 2 ) & 3;
        if( rota == 1 ) {
            q = vec2( q.y, 1.0 - q.x );
        } else if( rota == 2 ) {
            q = vec2( 1.0 - q.x, 1.0 - q.y );
        } else if( rota == 3 ) {
            q = vec2( 1.0 - q.y, q.x );
        }
        instance_uv = mix( uv_rect.xy, uv_rect.zw, q );
    }
    // Vehicle shells can remain visible to the sun while their near-field 2D
    // skin replaces them on screen.  They must not affect color or camera depth.
    if( ( flags & 32768 ) != 0 ) {
        discard;
    }
    const bool same_level_wall = ( flags & 1024 ) != 0;
    const bool mask_candidate = mask_params.w > 0.5 && !same_level_wall &&
                                v_world.z > mask_params.z + 0.15;
    // Most fragments do not use screen-door transparency. Avoid evaluating a
    // sine hash unless this fragment can actually enter a dithered branch.
    float hash = 0.0;
    if( same_level_wall || mask_candidate || ( flags & ( 32 | 128 ) ) != 0 ) {
        hash = fract( sin( dot( gl_FragCoord.xy,
                                vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    }

    // Same-level walls keep their full geometry, but only the lower third is
    // solid. A stable dither fades the next sixth; the entire upper half is gone.
    if( same_level_wall ) {
        float wall_h = clamp( v_tile.z * effect_params.z, 0.0, 1.0 );
        if( wall_h >= 0.5 ) {
            discard;
        }
        float hide = smoothstep( 1.0 / 3.0, 0.5, wall_h );
        if( hash < hide ) {
            discard;
        }
    }

    // camera->player occlusion mask: hide geometry near the eye-to-player
    // segment so walls and roofs never block the player. the cross-section is
    // an ellipse aligned with the screen (wider than tall), the edge band is
    // softened with a screen-door dither instead of alpha blending (no sorting
    // needed). only fragments above the player's own floor are masked, so the
    // ground the player stands on stays put
    if( mask_candidate ) {
        vec3 pa = v_world - eye_pos.xyz;
        vec3 ba = player_pos.xyz - eye_pos.xyz;
        float t_raw = dot( pa, ba ) / max( dot( ba, ba ), 1e-6 );
        float t = clamp( t_raw, 0.0, 1.0 );
        vec3 off = pa - ba * t;
        // offset from the axis in screen-aligned coordinates, normalized by the
        // ellipse radii: de <= 1 fully hidden, >= 1.5 fully visible
        float er = dot( off, cam_right.xyz ) / mask_params.x;
        float eu = dot( off, cam_up.xyz ) / mask_params.y;
        float de = sqrt( er * er + eu * eu );
        // also fade out past the player along the axis: the wall the player is
        // FACING (beyond them from the camera) must stay readable
        float hide = ( 1.0 - smoothstep( 1.0, 1.5, de ) ) *
                     ( 1.0 - smoothstep( 0.9, 1.1, t_raw ) );
        if( hash < hide ) {
            discard;
        }
    }

    // cursor-centered occlusion hole: independent of the eye->player mask,
    // with the same screen-door edge and the same eligible geometry/height gate
    if( cursor_params.z > 0.5 && mask_candidate ) {
        vec2 cursor_delta = ( v_screen - cursor_params.xy ) / effect_params.xy;
        float hide = 1.0 - smoothstep( 1.0, 1.5, length( cursor_delta ) );
        if( hash < hide ) {
            discard;
        }
    }

    // ghost (bit5): dithered 50% transparency for the levels above an indoor
    // column the player can see into — the roof stays perceptible but the
    // interior shows through
    if( ( flags & 32 ) != 0 && hash > 0.5 ) {
        discard;
    }

    bool textured = ( flags & 1 ) != 0;
    bool no_discard = ( flags & 2 ) != 0;
    // Alpha is an internal composite mask, not visible transparency. Distant
    // structural LOD and creature relations use distinct, exactly representable
    // values in the R8 offscreen target; the composite restores full opacity.
    float composite_alpha = 1.0;
    if( ( flags & 512 ) != 0 ) {
        composite_alpha = 0.0;
    } else if( ( flags & 2048 ) != 0 ) {
        composite_alpha = 0.25;
    } else if( ( flags & 4096 ) != 0 ) {
        composite_alpha = 0.5;
    } else if( ( flags & 8192 ) != 0 ) {
        composite_alpha = 0.75;
    }
    vec4 sampled = vec4( 1.0 );
    if( textured ) {
        sampled = texture( atlas_tex, instance_uv );
        if( !no_discard && sampled.a < 0.1 ) {
            discard;
        }
        // field layers: bit7 (128) renders translucent pixels as a screen-door
        // dither proportional to their alpha (the same trick as ghost), so
        // smoke, fire and blood edges read as translucent without blending
        if( ( flags & 128 ) != 0 && sampled.a < 0.9 && hash > sampled.a ) {
            discard;
        }
    }
    if( effect_params.w > 0.5 ) {
        out_color = vec4( 0.0 );
        return;
    }
    vec3 display_rgb = instance_color.rgb * sampled.rgb;
    vec3 normal = normalize( v_normal );
    if( v_wrap > 0.0 && dot( normal, eye_pos.xyz - v_world ) < 0.0 ) {
        normal = -normal;
    }
    vec3 light_dir = normalize( atmosphere_sun.xyz );
    float nv_face_shade = 0.82 + 0.18 * max( dot( normal, light_dir ), 0.0 );
    // remembered terrain (bit6): the map-memory palette is authored in display
    // space.  Convert it to linear so the common post chain can present it.
    if( ( flags & 64 ) != 0 ) {
        vec3 mem = memory_params.y > 0.5
                   ? memory_mixer( display_rgb, memory_dark.rgb, memory_light.rgb, memory_dark.w )
                   : memory_preset( int( memory_params.x + 0.5 ), display_rgb );
        // Negative material alpha marks remembered scenery for the sun-bounce
        // extraction pass. Water tests alpha < 0.5, so its behavior is unchanged.
        out_emissive = vec4( 0.0, 0.0, 0.0, -1.0 );
        out_color = vec4( color3d_srgb_to_linear( mem ), composite_alpha );
        return;
    }
    // Night vision keeps its own reference palette and brightness hand-over.
    if( nv_params.x > 0.5 ) {
        vec3 base = textured ? sampled.rgb : instance_color.rgb;
        float light = clamp( instance_color.a, 0.0, 1.0 );
        float av = ( base.r + base.g + base.b ) / 3.0;
        float night = min( av * ( av * 0.75 + 64.0 / 255.0 ) + 16.0 / 255.0, 1.0 );
        float over = min( 64.0 / 255.0 + av * ( av * 0.25 + 192.0 / 255.0 ), 1.0 );
        vec3 dim = nightvision_green( night * mix( nv_params.y, 1.0, light ) );
        vec3 nv = mix( dim, nightvision_green( over ),
                       smoothstep( nv_params.z, 1.0, light ) );
        out_color = vec4( color3d_srgb_to_linear( nv * nv_face_shade ), composite_alpha );
        return;
    }

    scene_light_sample scene_light = sample_scene_light();
    // Retain chroma well into darkness; only genuinely near-black cells approach
    // monochrome.  This is deliberately gentler than the 2D readability drain.
    float color_retention = mix( 0.52, 1.0,
                                 smoothstep( 0.0, 0.75, scene_light.intensity ) );
    float display_luma = color3d_luminance( display_rgb );
    display_rgb = mix( vec3( display_luma ), display_rgb, color_retention );
    vec3 albedo = color3d_srgb_to_linear( display_rgb );

    float ndotl = dot( normal, light_dir );
    float diffuse = clamp( ( ndotl + v_wrap ) / ( 1.0 + v_wrap ), 0.0, 1.0 );
    float shadow = sun_visibility( normal, light_dir );
    float cloud = mix( cloud_sun_visibility(), 1.0 - 0.75 * atmosphere_wind.z,
                       lighting_params.x );
    float light_fill = mix( 0.12, 1.0, pow( clamp( scene_light.intensity, 0.0, 1.0 ), 0.70 ) );
    // In daylight the sun owns outdoor surfaces and the shadow map owns indoor
    // occlusion.  At night the continuous map light also gates the weak moon key.
    float direct_fill = mix( 1.0, light_fill, lighting_params.x );
    vec3 direct = sunlight_color.rgb * sunlight_color.w *
                  ( diffuse * shadow * cloud * direct_fill );

    float hemisphere = clamp( normal.z * 0.5 + 0.5, 0.0, 1.0 );
    vec3 hemisphere_color = mix( ground_color.rgb, ambient_color.rgb, hemisphere );
    vec3 local_tint = mix( vec3( 1.0 ), scene_light.hue, lighting_params.y );
    vec3 ambient = hemisphere_color * ambient_color.w *
                   ( ambient_occlusion() * light_fill ) * local_tint;
    vec3 emission = instance_emission.rgb *
                    ( textured ? color3d_srgb_to_linear( sampled.rgb ) : vec3( 1.0 ) );
    // A transmitting opening is a source of visible sun spill, not merely a
    // surface that happens to face the sun. The high-energy source is kept out
    // of the visible surface so the glass and frame textures remain readable.
    bool sun_portal = ( flags & 131072 ) != 0 && bounce_params.x > 0.5;
    float portal_fade = 1.0 - smoothstep( lighting_params.z, lighting_params.w,
                                          length( v_world - eye_pos.xyz ) );
    vec3 portal_emission = vec3( 0.0 );
    if( sun_portal ) {
        vec3 portal_tint = mix( vec3( 1.0 ), albedo, 0.35 );
        float portal_day = clamp( atmosphere_sun.w, 0.0, 1.0 ) * cloud * portal_fade;
        portal_emission = sunlight_color.rgb * sunlight_color.w * bounce_params.z *
                          portal_day * portal_tint;
    }
    vec3 lit = albedo * ( ambient + direct ) + emission;
    if( sun_portal ) {
        // Match an ordinary fully sunlit surface instead of adding the halo's
        // HDR energy to the window itself. The separate emissive target keeps
        // the surrounding spill at its existing strength.
        vec3 portal_direct = sunlight_color.rgb * sunlight_color.w * cloud * portal_fade;
        lit = albedo * ( ambient + portal_direct ) + emission;
    }
    out_color = vec4( apply_air_perspective( lit ), composite_alpha );
    float material_alpha = sun_portal ? -2.0 : ( ( flags & 16384 ) != 0 ? 1.0 : 0.0 );
    out_emissive = vec4( emission + portal_emission, material_alpha );
}
