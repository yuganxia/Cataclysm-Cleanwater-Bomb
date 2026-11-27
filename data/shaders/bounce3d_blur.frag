// Depth-aware separable diffusion of the sun-bounce radiance. Only this
// lighting texture is blurred; scene color and geometry stay sharp.

#version 450

layout(set = 2, binding = 0) uniform sampler2D bounce_tex;

layout(set = 3, binding = 0) uniform BounceBlurUBO {
    vec4 direction;  // xy = one source texel along the axis, z = depth tolerance,
                     // w = world-space diffusion radius
    vec4 projection; // x = full screen height, y = tan(fov/2), z = max radius in texels
};

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 out_bounce_depth;

void main()
{
    ivec2 size = textureSize( bounce_tex, 0 );
    ivec2 center_pixel = clamp( ivec2( v_uv * vec2( size ) ), ivec2( 0 ), size - 1 );
    vec4 center = texelFetch( bounce_tex, center_pixel, 0 );
    float tolerance = max( 0.08, center.a * direction.z );
    float radius_pixels = clamp( direction.w * projection.x /
                                 ( 4.0 * projection.y * max( center.a, 0.1 ) ),
                                 2.0, projection.z );
    vec2 step_uv = direction.xy * ( radius_pixels / 8.0 );
    vec3 radiance = center.rgb;
    float weight_sum = 1.0;
    for( int i = 1; i <= 8; ++i ) {
        float spatial_weight = exp( -0.5 * float( i * i ) / ( 2.6 * 2.6 ) );
        vec2 offset = step_uv * float( i );
        for( int side = 0; side < 2; ++side ) {
            vec2 sample_uv = v_uv + ( side == 0 ? offset : -offset );
            if( sample_uv.x < 0.0 || sample_uv.x > 1.0 ||
                sample_uv.y < 0.0 || sample_uv.y > 1.0 ) {
                continue;
            }
            vec4 tap = texture( bounce_tex, sample_uv );
            float depth_weight = 1.0 - smoothstep( tolerance, tolerance * 3.0,
                                                   abs( tap.a - center.a ) );
            float weight = spatial_weight * depth_weight;
            radiance += tap.rgb * weight;
            weight_sum += weight;
        }
    }
    out_bounce_depth = vec4( radiance / max( weight_sum, 1.0e-5 ), center.a );
}
