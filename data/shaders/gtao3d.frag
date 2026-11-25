#version 450

layout(set = 2, binding = 0) uniform sampler2D depth_tex;

layout(set = 3, binding = 0) uniform GtaoUBO {
    vec4 cam_right;
    vec4 cam_up;
    vec4 cam_forward;
    vec4 proj_params;   // x = tan(fov/2), y = aspect, z = near, w = far
    vec4 screen_params; // xy = full-resolution dimensions
    vec4 ao_params;     // x = world radius, y = depth thickness, z = contrast
};

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 out_ao_depth;

float linear_depth( float depth )
{
    float zn = proj_params.z;
    float zf = proj_params.w;
    return zn * zf / max( zf - depth * ( zf - zn ), 1.0e-5 );
}

vec3 view_position( vec2 uv, float depth )
{
    vec2 ndc = vec2( uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0 );
    vec3 ray = cam_forward.xyz + cam_right.xyz * ( ndc.x * proj_params.x * proj_params.y ) +
               cam_up.xyz * ( ndc.y * proj_params.x );
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
    ivec2 depth_size = textureSize( depth_tex, 0 );
    ivec2 center_pixel = clamp( ivec2( v_uv * vec2( depth_size ) ), ivec2( 0 ), depth_size - 1 );
    float center_depth = texelFetch( depth_tex, center_pixel, 0 ).r;
    float view_depth = linear_depth( center_depth );
    if( center_depth >= 0.999999 ) {
        out_ao_depth = vec4( 1.0, view_depth, 0.0, 1.0 );
        return;
    }

    vec3 position = view_position( v_uv, center_depth );
    vec3 view_dir = normalize( -position );
    vec3 dx = dFdx( position );
    vec3 dy = dFdy( position );
    vec3 normal = cross( dx, dy );
    if( dot( normal, normal ) < 1.0e-10 ) {
        out_ao_depth = vec4( 1.0, view_depth, 0.0, 1.0 );
        return;
    }
    normal = normalize( normal );
    if( dot( normal, view_dir ) < 0.0 ) {
        normal = -normal;
    }

    const float PI = 3.14159265359;
    const float HALF_PI = 1.57079632679;
    float rotation = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) *
                            43758.5453 ) * PI * 0.25;
    float radius_pixels = clamp( ao_params.x * screen_params.y /
                                 ( 2.0 * proj_params.x * max( view_depth, 0.1 ) ), 2.0, 48.0 );
    float visibility = 0.0;

    for( int slice = 0; slice < 4; ++slice ) {
        float angle = rotation + float( slice ) * PI * 0.25;
        vec2 direction = vec2( cos( angle ), sin( angle ) );
        vec3 slice_direction = normalize( cam_right.xyz * direction.x - cam_up.xyz * direction.y );
        vec3 slice_normal = cross( slice_direction, view_dir );
        if( dot( slice_normal, slice_normal ) < 1.0e-8 ) {
            continue;
        }
        slice_normal = normalize( slice_normal );
        vec3 projected_normal = normal - slice_normal * dot( normal, slice_normal );
        float projected_length = length( projected_normal );
        if( projected_length < 1.0e-4 ) {
            continue;
        }
        projected_normal /= projected_length;
        float normal_angle = atan( dot( projected_normal, slice_direction ),
                                   dot( projected_normal, view_dir ) );
        float horizon_negative = -1.0;
        float horizon_positive = -1.0;

        for( int side = 0; side < 2; ++side ) {
            float side_sign = side == 0 ? -1.0 : 1.0;
            for( int step = 0; step < 4; ++step ) {
                float offset = radius_pixels * ( float( step ) + 0.5 ) / 4.0;
                vec2 sample_uv = v_uv + direction * ( side_sign * offset ) / screen_params.xy;
                if( sample_uv.x < 0.0 || sample_uv.x > 1.0 ||
                    sample_uv.y < 0.0 || sample_uv.y > 1.0 ) {
                    continue;
                }
                float sample_depth = depth_at( sample_uv );
                if( sample_depth >= 0.999999 ) {
                    continue;
                }
                float sample_view_depth = linear_depth( sample_depth );
                if( sample_view_depth > view_depth + ao_params.y ) {
                    continue;
                }
                vec3 delta = view_position( sample_uv, sample_depth ) - position;
                float distance_to_sample = length( delta );
                if( distance_to_sample < 1.0e-4 || distance_to_sample > ao_params.x ) {
                    continue;
                }
                float attenuation = clamp( 1.0 - ( distance_to_sample * distance_to_sample ) /
                                           ( ao_params.x * ao_params.x ), 0.0, 1.0 );
                float horizon = dot( delta / distance_to_sample, view_dir );
                horizon = mix( -1.0, horizon, attenuation );
                if( side == 0 ) {
                    horizon_negative = max( horizon_negative, horizon );
                } else {
                    horizon_positive = max( horizon_positive, horizon );
                }
            }
        }

        float h1 = -acos( clamp( horizon_negative, -1.0, 1.0 ) );
        float h2 = acos( clamp( horizon_positive, -1.0, 1.0 ) );
        h1 = normal_angle + max( h1 - normal_angle, -HALF_PI );
        h2 = normal_angle + min( h2 - normal_angle, HALF_PI );
        float sin_normal = sin( normal_angle );
        float cos_normal = cos( normal_angle );
        float integral = 0.25 * ( -cos( 2.0 * h1 - normal_angle ) + cos_normal +
                                  2.0 * h1 * sin_normal ) +
                         0.25 * ( -cos( 2.0 * h2 - normal_angle ) + cos_normal +
                                  2.0 * h2 * sin_normal );
        visibility += projected_length * integral;
    }

    visibility = pow( clamp( visibility * 0.25, 0.0, 1.0 ), ao_params.z );
    out_ao_depth = vec4( visibility, view_depth, 0.0, 1.0 );
}
