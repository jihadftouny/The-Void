/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

/**
 *
 * @author jihad
 */
public abstract class Character {
    
    //variables
    String name;
    int hp, maxHp, xp;
    int[] Stats; //every stat level up on the player (every upgrade) is a 3d4

    public Character(String name, int maxHp, int xp) {
        this.Stats = new int[]{10,10}; //Atk,Def
        this.name = name;
        this.maxHp = maxHp;
        this.xp = xp;
        hp = maxHp;
    }
    
    
    //methods every character has
    public abstract int attack();
    public abstract int defend();
    
}
