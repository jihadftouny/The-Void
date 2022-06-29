/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

/**
 *
 * @author jihad
 */
public class Enemy extends Character {

    //variable that stores the player current xp
    int playerXp;

    public Enemy(String name, int playerXp) {
        super(name, (int) (Math.random() * playerXp + playerXp / 3 + 30), (int) (Math.random() * (playerXp / 4 + 2) + 1)); //name maxhp xp
        this.playerXp = playerXp;
        Stats[0] = 10 + (int) (Math.random() * (playerXp / 4 + 1) + xp / 4 + 3);
        Stats[1] = 10 + (int) (Math.random() * (playerXp / 4 + 1) + xp / 4 + 3);
    }

    @Override
    public int attack() {
        return (int) (Math.random() * (playerXp / 4 + 1) + xp / 4 + 3);
    }

    @Override
    public int defend() {
        return (int) (Math.random() * (playerXp / 4 + 1) + xp / 4 + 3);
    }

}
