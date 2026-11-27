// Half-resolution direct-sun radiance for the local indoor bounce pass.
// The alpha channel carries linear view depth for the bilateral blur.

#version 450

layout(set = 2, binding = 0) uniform sampler2D scene_tex;
layout(set = 2, binding = 1) uniform sampler2D depth_tex;
layout(set = 2, binding = 2) uniform sampler2D shadow_tex;
layout(set = 2, binding = 3) uniform sampler2D material_tex;

layout(set = 3, binding = 0) uniform BounceExtractUBO {
    vec4 eye_pos;
    vec4 cam_right;
    vec4 cam_up;
    vec4 cam_forward;
    mat4 light_vp;
    vec4 ray_params;    // x = tan(fov/2), y = aspect, z = near, w = far
    vec4 sun_dir;       // xyz = direction toward sun, w = daylight
    vec4 shadow_params; // y = texel size, z = depth bias
    vec4 bounce_params; // y/z = distance fade start/end
};

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 out_bounce_depth;

float linear_depth( float depth )
{
    float zn = ray_params.z;
    float zf = ray_params.w;
    return zn * zf / max( zf - depth * ( zf - zn ), 1.0e-5 );
}

vec3 view_position( vec2 uv, float depth )
{
    vec2 ndc = vec2( uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0 );
    vec3 ray = cam_forward.xyz + cam_right.xyz * ( ndc.x * ray_params.x * ray_params.y ) +
               cam_up.xyz * ( ndc.y * ray_params.x );
    return ray * linear_depth( depth );
}

float depth_at( vec2 uv )
{
    ivec2 size = textureSize( depth_tex, 0 );
    ivec2 pixel = clamp( ivec2( uv * vec2( size ) ), ivec2( 0 ), size - 1 );
    return texelFetch( depth_tex, pixel, 0 ).r;
}

void main()
{
    float center_depth = depth_at( v_uv );
    float view_depth = linear_depth( center_depth );
    if( center_depth >= 0.999999 || sun_dir.w <= 0.05 ) {
        out_bounce_depth = vec4( 0.0, 0.0, 0.0, view_depth );
        return;
    }
    // Remembered terrain is marked with negative material alpha. It must not
    // become a new light source merely because its display palette is bright.
    vec4 material = texture( material_tex, v_uv );
    if( material.a < -1.5 ) {
        // A sun portal represents light passing through the opening. Its own
        // surface normal and shadow depth must not gate that transmitted light.
        float portal_fade = 1.0 - smoothstep( bounce_params.y, bounce_params.z, view_depth );
        vec3 portal = max( material.rgb, vec3( 0.0 ) ) * sun_dir.w * portal_fade;
        out_bounce_depth = vec4( portal, view_depth );
        return;
    }
    if( material.a < 0.0 ) {
        out_bounce_depth = vec4( 0.0, 0.0, 0.0, view_depth );
        return;
    }

    vec3 position = view_position( v_uv, center_depth );
    vec3 view_dir = normalize( -position );
    vec3 normal = cross( dFdx( position ), dFdy( position ) );
    if( dot( normal, normal ) < 1.0e-10 ) {
        out_bounce_depth = vec4( 0.0, 0.0, 0.0, view_depth );
        return;
    }
    normal = normalize( normal );
    if( dot( normal, view_dir ) < 0.0 ) {
        normal = -normal;
    }
    vec3 light_dir = normalize( sun_dir.xyz );
    float ndotl = max( dot( normal, light_dir ), 0.0 );
    if( ndotl <= 0.02 ) {
        out_bounce_depth = vec4( 0.0, 0.0, 0.0, view_depth );
        return;
    }

    vec3 world = eye_pos.xyz + position;
    float normal_offset = 0.018 + 0.045 * ( 1.0 - ndotl );
    vec4 light_pos = light_vp * vec4( world + normal * normal_offset, 1.0 );
    vec3 ndc = light_pos.xyz / light_pos.w;
    vec2 light_uv = vec2( ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5 );
    float visibility = 1.0;
    if( light_uv.x >= 0.0 && light_uv.x <= 1.0 && light_uv.y >= 0.0 &&
        light_uv.y <= 1.0 && ndc.z >= 0.0 && ndc.z <= 1.0 ) {
        const vec2 taps[4] = vec2[]( vec2( -1.0, -1.0 ), vec2( 1.0, -1.0 ),
                                     vec2( -1.0, 1.0 ), vec2( 1.0, 1.0 ) );
        float bias = shadow_params.z * ( 1.0 + 3.0 * ( 1.0 - ndotl ) );
        float radius = shadow_params.y * 1.5;
        visibility = 0.0;
        for( int i = 0; i < 4; ++i ) {
            float depth = texture( shadow_tex, light_uv + taps[i] * radius ).r;
            visibility += ndc.z - bias <= depth ? 0.25 : 0.0;
        }
    }

    float distance_fade = 1.0 - smoothstep( bounce_params.y, bounce_params.z, view_depth );
    float source_gate = visibility * smoothstep( 0.02, 0.28, ndotl ) *
                        sun_dir.w * distance_fade;
    vec3 scene = max( texture( scene_tex, v_uv ).rgb, vec3( 0.0 ) );
    out_bounce_depth = vec4( scene * source_gate, view_depth );
}
