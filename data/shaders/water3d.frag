#version 450
#extension GL_GOOGLE_include_directive : require

#include "sky3d.glsl"
#include "water_waves3d.glsl"

layout(set = 2, binding = 0) uniform sampler2D scene_tex;
layout(set = 2, binding = 1) uniform sampler2D depth_tex;
layout(set = 2, binding = 2) uniform sampler2D material_tex;

layout(set = 3, binding = 0) uniform WaterUBO {
    mat4 view_proj;
    vec4 eye_pos;
    vec4 cam_right;
    vec4 cam_up;
    vec4 cam_forward;
    vec4 sun_dir;
    vec4 ray_params;    // x = tan(fov/2), y = aspect, z = near, w = far
    vec4 wind;          // xy = cloud drift, z = cloudiness, w = storminess
    vec4 cloud_mapping;
    vec4 water_params;  // x = seconds, y = wave slope, z = max ray distance, w = depth thickness
    vec4 weather_params; // x = fog strength, y = rain strength
    vec4 flow;          // xy = world wind direction, z = normalized speed
    vec4 sunlight_color; // rgb = direct sun tint, w = direct-light gain
};

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 out_color;

float linear_depth( float depth )
{
    float zn = ray_params.z;
    float zf = ray_params.w;
    return zn * zf / max( zf - depth * ( zf - zn ), 1.0e-5 );
}

vec3 world_position( vec2 uv, float depth )
{
    vec2 ndc = vec2( uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0 );
    vec3 ray = cam_forward.xyz + cam_right.xyz * ( ndc.x * ray_params.x * ray_params.y ) +
               cam_up.xyz * ( ndc.y * ray_params.x );
    return eye_pos.xyz + ray * linear_depth( depth );
}

bool project_world( vec3 position, out vec2 uv, out float depth, out float view_depth )
{
    vec4 clip = view_proj * vec4( position, 1.0 );
    if( clip.w <= 0.0 ) {
        return false;
    }
    vec3 ndc = clip.xyz / clip.w;
    uv = vec2( ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5 );
    depth = ndc.z;
    view_depth = linear_depth( depth );
    return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0 &&
           depth >= 0.0 && depth <= 1.0;
}

bool trace_reflection( vec3 origin, vec3 direction, out vec2 hit_uv )
{
    float step_size = 0.20;
    float travel = 0.06;
    float previous_travel = travel;
    for( int i = 0; i < 30; ++i ) {
        previous_travel = travel;
        travel = min( travel + step_size, water_params.z );
        vec2 uv;
        float ray_depth;
        float ray_view_depth;
        if( !project_world( origin + direction * travel, uv, ray_depth, ray_view_depth ) ) {
            return false;
        }
        float scene_depth = texture( depth_tex, uv ).r;
        float scene_view_depth = linear_depth( scene_depth );
        if( scene_depth < 0.999999 && ray_view_depth >= scene_view_depth &&
            texture( material_tex, uv ).a < 0.5 ) {
            float low = previous_travel;
            float high = travel;
            for( int refinement = 0; refinement < 4; ++refinement ) {
                float middle = ( low + high ) * 0.5;
                vec2 middle_uv;
                float middle_depth;
                float middle_view_depth;
                if( !project_world( origin + direction * middle, middle_uv, middle_depth,
                                    middle_view_depth ) ) {
                    return false;
                }
                float middle_scene_depth = linear_depth( texture( depth_tex, middle_uv ).r );
                if( middle_view_depth < middle_scene_depth ) {
                    low = middle;
                } else {
                    high = middle;
                }
            }
            float final_depth;
            float final_view_depth;
            if( !project_world( origin + direction * high, hit_uv, final_depth, final_view_depth ) ) {
                return false;
            }
            float final_scene_depth = linear_depth( texture( depth_tex, hit_uv ).r );
            float thickness = water_params.w * ( 1.0 + final_scene_depth * 0.05 );
            return abs( final_view_depth - final_scene_depth ) <= thickness * 2.0 &&
                   texture( material_tex, hit_uv ).a < 0.5;
        }
        if( travel >= water_params.z ) {
            break;
        }
        step_size *= 1.10;
    }
    return false;
}

float edge_fade( vec2 uv )
{
    vec2 fade = smoothstep( vec2( 0.0 ), vec2( 0.08 ), uv ) *
                smoothstep( vec2( 0.0 ), vec2( 0.08 ), 1.0 - uv );
    return fade.x * fade.y;
}

float shoreline_mask( float view_depth )
{
    vec2 texel = 1.0 / vec2( textureSize( material_tex, 0 ) );
    float radius = clamp( 56.0 / max( view_depth, 1.0 ), 2.0, 7.0 );
    const vec2 directions[4] = vec2[](
        vec2( 1.0, 0.0 ), vec2( -1.0, 0.0 ), vec2( 0.0, 1.0 ), vec2( 0.0, -1.0 ) );
    float shore = 0.0;
    for( int i = 0; i < 4; ++i ) {
        vec2 sample_uv = clamp( v_uv + directions[i] * texel * radius,
                                vec2( 0.001 ), vec2( 0.999 ) );
        shore = max( shore, 1.0 - step( 0.5, texture( material_tex, sample_uv ).a ) );
    }
    return shore;
}

void main()
{
    vec4 scene = texture( scene_tex, v_uv );
    if( texture( material_tex, v_uv ).a < 0.5 ) {
        out_color = scene;
        return;
    }

    float depth = texture( depth_tex, v_uv ).r;
    if( depth >= 0.999999 ) {
        out_color = scene;
        return;
    }
    float view_depth = linear_depth( depth );
    vec3 position = world_position( v_uv, depth );
    vec2 world_xy = position.xy + cloud_mapping.xy;
    vec3 normal = water_wave_normal( world_xy, flow.xy, water_params.x, water_params.y,
                                     flow.z, weather_params.y );
    vec3 view_direction = normalize( position - eye_pos.xyz );

    vec2 refraction_offset = normal.xy * ( 0.018 + water_params.y * 0.055 ) /
                             max( view_depth * 0.12, 1.0 );
    refraction_offset.x /= max( ray_params.y, 0.01 );
    vec2 refracted_uv = clamp( v_uv + refraction_offset, vec2( 0.001 ), vec2( 0.999 ) );
    float refracted_scene_depth = linear_depth( texture( depth_tex, refracted_uv ).r );
    vec3 refracted = scene.rgb;
    if( refracted_scene_depth >= view_depth - 0.03 ) {
        refracted = texture( scene_tex, refracted_uv ).rgb;
    }
    vec3 base = refracted * vec3( 0.82, 0.93, 0.96 );

    vec3 reflected_direction = normalize( reflect( view_direction, normal ) );
    vec3 reflected_sun;
    vec3 sky = sky3d_radiance( reflected_direction, eye_pos.xyz, sun_dir.xyz,
                               clamp( sun_dir.w, 0.0, 1.0 ), wind.z, wind.w, weather_params.x, wind.xy,
                               cloud_mapping.xy, cloud_mapping.z, cloud_mapping.w,
                               reflected_sun );
    vec2 hit_uv;
    bool hit = trace_reflection( position + normal * 0.035, reflected_direction, hit_uv );
    vec3 reflection = sky;
    if( hit ) {
        reflection = mix( sky, texture( scene_tex, hit_uv ).rgb, edge_fade( hit_uv ) * 0.92 );
    }

    float cos_view = clamp( dot( normal, -view_direction ), 0.0, 1.0 );
    float fresnel = min( 0.02 + 0.98 * pow( 1.0 - cos_view, 5.0 ), 0.94 );
    vec3 color = mix( base, reflection, fresnel );

    vec3 half_direction = normalize( sun_dir.xyz - view_direction );
    float normal_half = max( dot( normal, half_direction ), 0.0 );
    float normal_light = max( dot( normal, sun_dir.xyz ), 0.0 );
    float roughness = mix( 0.16, 0.24, clamp( flow.z, 0.0, 1.0 ) );
    float alpha = roughness * roughness;
    float alpha_squared = alpha * alpha;
    float denominator = normal_half * normal_half * ( alpha_squared - 1.0 ) + 1.0;
    float distribution = alpha_squared /
                         max( 3.14159265 * denominator * denominator, 1.0e-5 );
    float sun_visibility = sun_dir.w < 0.0 ? 0.0 :
                           max( clamp( sun_dir.w, 0.0, 1.0 ), 0.14 ) * ( 1.0 - wind.z * 0.72 );
    vec3 glint = sunlight_color.rgb * min( distribution * normal_light * 0.008, 8.0 ) *
                 sun_visibility;
    color += glint;

    float foam_noise = atmosphere_fbm( world_xy * 2.8 + flow.xy * water_params.x * 0.18 );
    float foam = shoreline_mask( view_depth ) * smoothstep( 0.42, 0.72, foam_noise ) * 0.48;
    vec3 foam_color = mix( vec3( 0.07, 0.09, 0.11 ), vec3( 0.78, 0.87, 0.92 ),
                           clamp( sun_dir.w, 0.0, 1.0 ) );
    color = mix( color, foam_color, foam * ( 1.0 - fresnel * 0.45 ) );
    out_color = vec4( color, scene.a );
}
