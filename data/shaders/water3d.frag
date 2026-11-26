#version 450
#extension GL_GOOGLE_include_directive : require

#include "sky3d.glsl"

layout(set = 2, binding = 0) uniform sampler2D scene_tex;
layout(set = 2, binding = 1) uniform sampler2D depth_tex;
layout(set = 2, binding = 2) uniform sampler2D material_tex;

layout(set = 3, binding = 0) uniform WaterUBO {
    mat4 view_proj;
    vec4 eye_pos;       // xyz = camera position in scene coordinates
    vec4 cam_right;
    vec4 cam_up;
    vec4 cam_forward;
    vec4 sun_dir;       // xyz = direction toward sun, w = daylight
    vec4 ray_params;    // x = tan(fov/2), y = aspect, z = near, w = far
    vec4 wind;          // xy = cloud drift in noise space
    vec4 cloud_mapping; // xy = map origin, z = cloud height, w = cloud XY scale
    vec4 water_params;  // x = seconds, y = wave slope, z = max ray distance, w = depth thickness
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

vec3 wave_normal( vec2 position )
{
    float time = water_params.x;
    float slope = water_params.y;
    vec2 direction0 = normalize( vec2( 0.82, 0.57 ) );
    vec2 direction1 = normalize( vec2( -0.31, 0.95 ) );
    vec2 direction2 = normalize( vec2( 0.96, -0.28 ) );
    float phase0 = dot( direction0, position ) * 4.8 + time * 1.25;
    float phase1 = dot( direction1, position ) * 7.3 - time * 1.65;
    float phase2 = dot( direction2, position ) * 12.1 + time * 2.1;
    vec2 gradient = direction0 * ( cos( phase0 ) * slope ) +
                    direction1 * ( cos( phase1 ) * slope * 0.55 ) +
                    direction2 * ( cos( phase2 ) * slope * 0.18 );
    return normalize( vec3( -gradient, 1.0 ) );
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
    float step_size = 0.22;
    float travel = 0.08;
    for( int i = 0; i < 28; ++i ) {
        travel = min( travel + step_size, water_params.z );
        vec2 uv;
        float ray_depth;
        float ray_view_depth;
        if( !project_world( origin + direction * travel, uv, ray_depth, ray_view_depth ) ) {
            return false;
        }
        float scene_depth = texture( depth_tex, uv ).r;
        float scene_view_depth = linear_depth( scene_depth );
        float thickness = water_params.w * ( 1.0 + scene_view_depth * 0.05 );
        if( scene_depth < 0.999999 && ray_view_depth >= scene_view_depth &&
            ray_view_depth - scene_view_depth <= thickness &&
            texture( material_tex, uv ).a < 0.5 ) {
            hit_uv = uv;
            return true;
        }
        if( travel >= water_params.z ) {
            break;
        }
        step_size *= 1.11;
    }
    return false;
}

float edge_fade( vec2 uv )
{
    vec2 fade = smoothstep( vec2( 0.0 ), vec2( 0.08 ), uv ) *
                smoothstep( vec2( 0.0 ), vec2( 0.08 ), 1.0 - uv );
    return fade.x * fade.y;
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
    vec3 position = world_position( v_uv, depth );
    vec3 normal = wave_normal( position.xy + cloud_mapping.xy );
    vec3 view_direction = normalize( position - eye_pos.xyz );
    vec3 reflected_direction = normalize( reflect( view_direction, normal ) );
    vec3 reflected_sun;
    vec3 sky = sky3d_radiance( reflected_direction, eye_pos.xyz, sun_dir.xyz,
                               clamp( sun_dir.w, 0.0, 1.0 ), wind.z, wind.xy,
                               cloud_mapping.xy, cloud_mapping.z, cloud_mapping.w,
                               reflected_sun );

    vec2 hit_uv;
    bool hit = trace_reflection( position + normal * 0.035, reflected_direction, hit_uv );
    vec3 reflection = sky;
    if( hit ) {
        reflection = mix( sky, texture( scene_tex, hit_uv ).rgb, edge_fade( hit_uv ) );
    }
    float cos_view = clamp( dot( normal, -view_direction ), 0.0, 1.0 );
    float fresnel = min( 0.02 + 0.98 * pow( 1.0 - cos_view, 5.0 ), 0.85 );
    out_color = vec4( mix( scene.rgb, reflection, fresnel ), scene.a );
}
