#version 450

layout(set = 2, binding = 0) uniform sampler2D bloom_tex;

layout(set = 3, binding = 0) uniform BlurUBO {
    vec4 direction_radius; // xy = one texel along the blur axis, z = radius scale
};

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 out_color;

void main()
{
    const float weights[5] = float[]( 0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216 );
    vec2 step_uv = direction_radius.xy * direction_radius.z;
    vec3 color = texture( bloom_tex, v_uv ).rgb * weights[0];
    for( int i = 1; i < 5; ++i ) {
        vec2 offset = step_uv * float( i );
        color += texture( bloom_tex, v_uv + offset ).rgb * weights[i];
        color += texture( bloom_tex, v_uv - offset ).rgb * weights[i];
    }
    out_color = vec4( color, 1.0 );
}
