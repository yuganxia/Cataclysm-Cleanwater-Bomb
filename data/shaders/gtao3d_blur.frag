#version 450

layout(set = 2, binding = 0) uniform sampler2D ao_raw_tex;

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 out_ao;

void main()
{
    ivec2 size = textureSize( ao_raw_tex, 0 );
    ivec2 center_pixel = clamp( ivec2( v_uv * vec2( size ) ), ivec2( 0 ), size - 1 );
    vec2 center = texelFetch( ao_raw_tex, center_pixel, 0 ).rg;
    float tolerance = max( 0.08, center.g * 0.025 );
    float weighted_ao = 0.0;
    float weight_sum = 0.0;
    for( int y = -1; y <= 2; ++y ) {
        for( int x = -1; x <= 2; ++x ) {
            ivec2 pixel = clamp( center_pixel + ivec2( x, y ), ivec2( 0 ), size - 1 );
            vec2 sample_ao_depth = texelFetch( ao_raw_tex, pixel, 0 ).rg;
            float depth_weight = 1.0 - smoothstep( tolerance, tolerance * 3.0,
                                                   abs( sample_ao_depth.g - center.g ) );
            float wx = ( x == -1 || x == 2 ) ? 0.5 : 1.0;
            float wy = ( y == -1 || y == 2 ) ? 0.5 : 1.0;
            float weight = wx * wy * depth_weight;
            weighted_ao += sample_ao_depth.r * weight;
            weight_sum += weight;
        }
    }
    float ao = weight_sum > 1.0e-5 ? weighted_ao / weight_sum : center.r;
    out_ao = vec4( ao, 0.0, 0.0, 1.0 );
}
